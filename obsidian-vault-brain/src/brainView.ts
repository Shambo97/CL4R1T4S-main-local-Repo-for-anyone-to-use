import { ItemView, Menu, TFile, WorkspaceLeaf } from "obsidian";
import type VaultBrainPlugin from "./main";
import { BrainEdge, BrainGraph, BrainNode, buildBrainGraph } from "./brainGraph";
import { layoutBrainNodes, LayoutPoint } from "./brainLayout";
import { kindColor, kindLegend, regionLabel } from "./brainPalette";
import { BrainRegion } from "./settings";

export const VIEW_TYPE_BRAIN = "vault-brain-graph-view";

const WORLD_W = 1000;
const WORLD_H = 760;
const REFRESH_DEBOUNCE_MS = 800;
const DRAG_THRESHOLD_PX = 4;
const MAX_DRAWN_EDGES = 4000;

/** Hand-drawn side-profile brain silhouette, as fractions of (WORLD_W, WORLD_H). Not anatomically
 *  precise — just enough shape (frontal bulge, parietal crown, occipital back, cerebellum notch,
 *  brainstem tail, temporal underside) that the lobe tinting reads as a brain rather than a blob. */
const OUTLINE: [number, number][] = [
	[0.3, 0.05],
	[0.58, 0.03],
	[0.75, 0.08],
	[0.9, 0.12],
	[0.97, 0.2],
	[0.95, 0.3],
	[0.92, 0.45],
	[0.85, 0.52],
	[0.8, 0.55],
	[0.87, 0.58],
	[0.93, 0.62],
	[0.9, 0.68],
	[0.88, 0.8],
	[0.75, 0.95],
	[0.68, 0.97],
	[0.6, 0.95],
	[0.45, 0.9],
	[0.38, 0.8],
	[0.3, 0.85],
	[0.12, 0.72],
	[0.1, 0.62],
	[0.08, 0.55],
	[0.05, 0.45],
	[0.03, 0.35],
	[0.05, 0.2],
	[0.15, 0.08],
];

interface ScreenNode {
	node: BrainNode;
	x: number;
	y: number;
	radius: number;
}

/** Renders the vault as an interactive lobed brain map: notes are classified into a kind and a lobe
 *  (via brainGraph.ts) and drawn as sized/colored nodes, connected by the vault's real resolved links.
 *  Pan/zoom/hover/click are plain canvas + DOM event handling — no WebGL, no continuous render loop —
 *  so it stays cheap at rest and scales to large vaults without a GPU dependency. */
export class BrainView extends ItemView {
	private plugin: VaultBrainPlugin;
	private canvas!: HTMLCanvasElement;
	private ctx!: CanvasRenderingContext2D;
	private tooltipEl!: HTMLDivElement;
	private searchInput!: HTMLInputElement;
	private legendEl!: HTMLDivElement;
	private resizeObserver?: ResizeObserver;

	private graph: BrainGraph = { nodes: [], edges: [], maxDegree: 0 };
	private positions: Map<string, LayoutPoint> = new Map();
	private screenNodes: ScreenNode[] = [];
	private nodesByPath: Map<string, BrainNode> = new Map();

	private camera = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 };
	private hovered: BrainNode | null = null;
	private searchTerm = "";
	private showAllLinks = false;
	private isPointerDown = false;
	private isDragging = false;
	private lastPointer = { x: 0, y: 0 };
	private refreshTimer: number | null = null;
	private pulsePhase = 0;

	constructor(leaf: WorkspaceLeaf, plugin: VaultBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_BRAIN;
	}

	getDisplayText(): string {
		return "Brain view";
	}

	getIcon(): string {
		return "brain";
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("vault-brain-view");

		const toolbar = container.createDiv({ cls: "vault-brain-toolbar" });
		this.buildToolbar(toolbar);

		const stage = container.createDiv({ cls: "vault-brain-stage" });
		this.canvas = stage.createEl("canvas", { cls: "vault-brain-canvas" });
		const ctx = this.canvas.getContext("2d");
		if (!ctx) throw new Error("Vault Brain: 2D canvas context unavailable.");
		this.ctx = ctx;

		this.tooltipEl = stage.createDiv({ cls: "vault-brain-tooltip" });
		this.tooltipEl.hide();

		this.legendEl = container.createDiv({ cls: "vault-brain-legend" });
		this.buildLegend();

		this.registerCanvasEvents();

		this.resizeObserver = new ResizeObserver(() => this.handleResize());
		this.resizeObserver.observe(stage);

		this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));

		// A lightweight interval rather than a continuous requestAnimationFrame loop: it costs nothing
		// when "Idle pulse" is off (the common case), and even when on it only needs a few redraws/sec.
		this.registerInterval(
			window.setInterval(() => {
				if (!this.plugin.settings.brainView.idlePulse) return;
				this.pulsePhase = (Date.now() % 2400) / 2400;
				this.draw();
			}, 120)
		);

		this.rebuild();
	}

	async onClose(): Promise<void> {
		this.resizeObserver?.disconnect();
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
	}

	// ---------------------------------------------------------------- Toolbar / legend

	private buildToolbar(toolbar: HTMLElement): void {
		this.searchInput = toolbar.createEl("input", {
			cls: "vault-brain-search",
			attr: { type: "text", placeholder: "Find a note…" },
		});
		this.searchInput.addEventListener("input", () => {
			this.searchTerm = this.searchInput.value.trim().toLowerCase();
			this.draw();
		});

		const linksToggle = toolbar.createEl("label", { cls: "vault-brain-toggle" });
		const linksCheckbox = linksToggle.createEl("input", { attr: { type: "checkbox" } });
		linksCheckbox.checked = this.showAllLinks;
		linksToggle.createSpan({ text: "Show all links" });
		linksCheckbox.addEventListener("change", () => {
			this.showAllLinks = linksCheckbox.checked;
			this.draw();
		});

		const regions = toolbar.createDiv({ cls: "vault-brain-region-toggles" });
		const allRegions: BrainRegion[] = ["frontal", "parietal", "temporal", "occipital", "cerebellum", "stem"];
		for (const region of allRegions) {
			const chip = regions.createEl("button", { cls: "vault-brain-chip", text: region });
			this.updateChipState(chip, region);
			chip.addEventListener("click", async () => {
				const enabled = this.plugin.settings.brainView.enabledRegions;
				enabled[region] = !enabled[region];
				await this.plugin.saveSettings();
				this.updateChipState(chip, region);
				this.draw();
			});
		}

		const recenter = toolbar.createEl("button", { cls: "vault-brain-recenter", text: "Recenter" });
		recenter.addEventListener("click", () => this.resetCamera());
	}

	private updateChipState(chip: HTMLElement, region: BrainRegion): void {
		chip.toggleClass("is-active", this.plugin.settings.brainView.enabledRegions[region]);
		chip.setAttr("title", regionLabel(region));
	}

	private buildLegend(): void {
		this.legendEl.empty();
		for (const entry of kindLegend()) {
			const item = this.legendEl.createDiv({ cls: "vault-brain-legend-item" });
			const swatch = item.createSpan({ cls: "vault-brain-legend-swatch" });
			swatch.setCssStyles({ backgroundColor: kindColor(entry.kind, this.plugin.settings.brainView.palette) });
			item.createSpan({ text: entry.label });
		}
	}

	// ---------------------------------------------------------------- Data / layout

	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => this.rebuild(), REFRESH_DEBOUNCE_MS);
	}

	private rebuild(): void {
		this.graph = buildBrainGraph(this.app, this.plugin.settings.brainView);
		this.positions = layoutBrainNodes(this.graph.nodes);
		this.nodesByPath = new Map(this.graph.nodes.map((n) => [n.file.path, n]));
		this.buildLegend();
		this.handleResize();
	}

	// ---------------------------------------------------------------- Canvas sizing / transforms

	private handleResize(): void {
		const stage = this.canvas.parentElement;
		if (!stage) return;
		const rect = stage.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
		this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
		this.canvas.style.width = `${rect.width}px`;
		this.canvas.style.height = `${rect.height}px`;
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (this.camera.zoom === 1 && rect.width > 0) this.resetCamera(rect.width, rect.height);
		else this.draw();
	}

	private resetCamera(widthOverride?: number, heightOverride?: number): void {
		const rect = this.canvas.getBoundingClientRect();
		const width = widthOverride ?? rect.width;
		const height = heightOverride ?? rect.height;
		this.camera.x = WORLD_W / 2;
		this.camera.y = WORLD_H / 2;
		this.camera.zoom = Math.max(0.05, Math.min(width / WORLD_W, height / WORLD_H) * 0.92);
		this.draw();
	}

	private worldToScreen(x: number, y: number): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		return {
			x: rect.width / 2 + (x - this.camera.x) * this.camera.zoom,
			y: rect.height / 2 + (y - this.camera.y) * this.camera.zoom,
		};
	}

	private screenToWorld(x: number, y: number): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		return {
			x: this.camera.x + (x - rect.width / 2) / this.camera.zoom,
			y: this.camera.y + (y - rect.height / 2) / this.camera.zoom,
		};
	}

	// ---------------------------------------------------------------- Interaction

	private registerCanvasEvents(): void {
		this.canvas.addEventListener("pointerdown", (e) => {
			this.isPointerDown = true;
			this.isDragging = false;
			this.lastPointer = { x: e.clientX, y: e.clientY };
			this.canvas.setPointerCapture(e.pointerId);
		});

		this.canvas.addEventListener("pointermove", (e) => {
			if (this.isPointerDown) {
				const dx = e.clientX - this.lastPointer.x;
				const dy = e.clientY - this.lastPointer.y;
				if (!this.isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) this.isDragging = true;
				if (this.isDragging) {
					this.camera.x -= dx / this.camera.zoom;
					this.camera.y -= dy / this.camera.zoom;
					this.lastPointer = { x: e.clientX, y: e.clientY };
					this.draw();
				}
				return;
			}
			const rect = this.canvas.getBoundingClientRect();
			const found = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
			if (found?.node !== this.hovered) {
				this.hovered = found?.node ?? null;
				this.draw();
			}
			this.positionTooltip(found, e.clientX - rect.left, e.clientY - rect.top);
		});

		const endDrag = (e: PointerEvent) => {
			if (this.isPointerDown && !this.isDragging) {
				const rect = this.canvas.getBoundingClientRect();
				const found = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
				if (found) this.openNode(found.node, e);
			}
			this.isPointerDown = false;
			this.isDragging = false;
		};
		this.canvas.addEventListener("pointerup", endDrag);
		this.canvas.addEventListener("pointerleave", () => {
			this.hovered = null;
			this.tooltipEl.hide();
			this.draw();
		});

		this.canvas.addEventListener(
			"wheel",
			(e) => {
				e.preventDefault();
				const rect = this.canvas.getBoundingClientRect();
				const before = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
				const factor = Math.exp(-e.deltaY * 0.001);
				this.camera.zoom = Math.max(0.05, Math.min(8, this.camera.zoom * factor));
				const after = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
				this.camera.x -= after.x - before.x;
				this.camera.y -= after.y - before.y;
				this.draw();
			},
			{ passive: false }
		);

		this.canvas.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			const rect = this.canvas.getBoundingClientRect();
			const found = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
			if (!found) return;
			const menu = new Menu();
			menu.addItem((item) => item.setTitle("Open note").setIcon("file-text").onClick(() => this.openLeaf(found.node.file, false)));
			menu.addItem((item) => item.setTitle("Open in new tab").setIcon("plus").onClick(() => this.openLeaf(found.node.file, true)));
			menu.showAtMouseEvent(e);
		});
	}

	private hitTest(px: number, py: number): ScreenNode | undefined {
		let best: ScreenNode | undefined;
		let bestDist = Infinity;
		for (const sn of this.screenNodes) {
			const dist = Math.hypot(sn.x - px, sn.y - py);
			const tolerance = sn.radius + 3;
			if (dist <= tolerance && dist < bestDist) {
				best = sn;
				bestDist = dist;
			}
		}
		return best;
	}

	private positionTooltip(found: ScreenNode | undefined, px: number, py: number): void {
		if (!found) {
			this.tooltipEl.hide();
			return;
		}
		const node = found.node;
		this.tooltipEl.empty();
		this.tooltipEl.createDiv({ cls: "vault-brain-tooltip-title", text: node.file.basename });
		this.tooltipEl.createDiv({
			cls: "vault-brain-tooltip-meta",
			text: `${node.kind} · ${regionLabel(node.region)} · ${node.degree} link${node.degree === 1 ? "" : "s"}`,
		});
		this.tooltipEl.show();
		this.tooltipEl.setCssStyles({ left: `${px + 14}px`, top: `${py + 14}px` });
	}

	private openNode(node: BrainNode, e: PointerEvent): void {
		const action = this.plugin.settings.brainView.clickAction;
		if (action === "preview") {
			this.app.workspace.trigger("hover-link", {
				event: e,
				source: "vault-brain",
				hoverParent: this,
				targetEl: this.canvas,
				linktext: node.file.path,
			});
			return;
		}
		this.openLeaf(node.file, action === "newTab");
	}

	private openLeaf(file: TFile, newTab: boolean): void {
		const leaf = this.app.workspace.getLeaf(newTab);
		void leaf.openFile(file);
	}

	// ---------------------------------------------------------------- Drawing

	private draw(): void {
		const ctx = this.ctx;
		const rect = this.canvas.getBoundingClientRect();
		ctx.clearRect(0, 0, rect.width, rect.height);

		const styles = getComputedStyle(this.canvas);
		const bg = styles.getPropertyValue("--background-primary").trim() || "#1e1e1e";
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, rect.width, rect.height);

		const outlinePath = this.buildOutlinePath();
		this.drawLobeTints(outlinePath);

		const outlineColor = styles.getPropertyValue("--text-faint").trim() || "rgba(255,255,255,0.25)";
		ctx.strokeStyle = outlineColor;
		ctx.lineWidth = Math.max(1, 1.5 * this.camera.zoom * 0.6);
		ctx.stroke(outlinePath);

		this.screenNodes = this.computeScreenNodes();
		this.drawEdges();
		this.drawNodes();
	}

	private buildOutlinePath(): Path2D {
		const path = new Path2D();
		const pts = OUTLINE.map(([fx, fy]) => this.worldToScreen(fx * WORLD_W, fy * WORLD_H));
		path.moveTo(pts[0].x, pts[0].y);
		for (let i = 1; i < pts.length; i++) {
			const prev = pts[i - 1];
			const curr = pts[i];
			const midX = (prev.x + curr.x) / 2;
			const midY = (prev.y + curr.y) / 2;
			path.quadraticCurveTo(prev.x, prev.y, midX, midY);
		}
		path.closePath();
		return path;
	}

	private drawLobeTints(outlinePath: Path2D): void {
		const ctx = this.ctx;
		const enabled = this.plugin.settings.brainView.enabledRegions;
		ctx.save();
		ctx.clip(outlinePath);
		const anchors = { frontal: [0.26, 0.38, 0.28], parietal: [0.55, 0.2, 0.25], occipital: [0.83, 0.34, 0.2], temporal: [0.44, 0.68, 0.26], cerebellum: [0.78, 0.7, 0.18], stem: [0.62, 0.92, 0.12] } as Record<BrainRegion, [number, number, number]>;
		const palette = this.plugin.settings.brainView.palette;
		const regionHue: Record<BrainRegion, number> = { frontal: 210, parietal: 265, temporal: 330, occipital: 40, cerebellum: 95, stem: 150 };
		for (const region of Object.keys(anchors) as BrainRegion[]) {
			const [fx, fy, fr] = anchors[region];
			const center = this.worldToScreen(fx * WORLD_W, fy * WORLD_H);
			const radius = fr * WORLD_W * this.camera.zoom;
			const alpha = enabled[region] ? (palette === "mono" ? 0.05 : 0.1) : 0.03;
			const gradient = this.ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
			gradient.addColorStop(0, `hsla(${regionHue[region]}, 60%, 55%, ${alpha})`);
			gradient.addColorStop(1, `hsla(${regionHue[region]}, 60%, 55%, 0)`);
			ctx.fillStyle = gradient;
			ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
		}
		ctx.restore();
	}

	private computeScreenNodes(): ScreenNode[] {
		const enabled = this.plugin.settings.brainView.enabledRegions;
		const out: ScreenNode[] = [];
		for (const node of this.graph.nodes) {
			if (!enabled[node.region]) continue;
			const pos = this.positions.get(node.file.path);
			if (!pos) continue;
			const screen = this.worldToScreen(pos.x * WORLD_W, pos.y * WORLD_H);
			const base = 2.6 + Math.sqrt(node.degree) * 1.4;
			const radius = Math.max(1.5, base * this.camera.zoom * 0.55);
			out.push({ node, x: screen.x, y: screen.y, radius });
		}
		return out;
	}

	private drawEdges(): void {
		const ctx = this.ctx;
		const enabled = this.plugin.settings.brainView.enabledRegions;
		const screenByPath = new Map(this.screenNodes.map((sn) => [sn.node.file.path, sn]));
		let drawn = 0;

		const shouldDraw = (edge: BrainEdge): boolean => {
			if (this.hovered && (edge.source === this.hovered.file.path || edge.target === this.hovered.file.path)) return true;
			const sourceNode = this.nodesByPath.get(edge.source);
			const targetNode = this.nodesByPath.get(edge.target);
			if (!sourceNode || !targetNode || !enabled[sourceNode.region] || !enabled[targetNode.region]) return false;
			if (this.showAllLinks) return true;
			return sourceNode.isHub || targetNode.isHub;
		};

		ctx.lineWidth = 1;
		for (const edge of this.graph.edges) {
			if (drawn >= MAX_DRAWN_EDGES) break;
			if (!shouldDraw(edge)) continue;
			const a = screenByPath.get(edge.source);
			const b = screenByPath.get(edge.target);
			if (!a || !b) continue;
			const isHoverEdge = this.hovered && (edge.source === this.hovered.file.path || edge.target === this.hovered.file.path);
			ctx.strokeStyle = isHoverEdge ? "rgba(255, 200, 120, 0.85)" : "rgba(150, 160, 190, 0.18)";
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.stroke();
			drawn += 1;
		}
	}

	private drawNodes(): void {
		const ctx = this.ctx;
		const palette = this.plugin.settings.brainView.palette;
		const hasSearch = this.searchTerm.length > 0;

		for (const sn of this.screenNodes) {
			const matches = !hasSearch || sn.node.file.basename.toLowerCase().includes(this.searchTerm);
			const isHovered = sn.node === this.hovered;
			const alpha = matches ? 1 : 0.15;

			ctx.globalAlpha = alpha;
			ctx.fillStyle = kindColor(sn.node.kind, palette);
			ctx.beginPath();
			ctx.arc(sn.x, sn.y, sn.radius, 0, Math.PI * 2);
			ctx.fill();

			if (sn.node.isHub) {
				const pulse = this.plugin.settings.brainView.idlePulse ? 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(this.pulsePhase * Math.PI * 2)) : 0.55;
				ctx.globalAlpha = alpha * 0.9;
				ctx.strokeStyle = `rgba(255, 255, 255, ${pulse})`;
				ctx.lineWidth = 1.2;
				ctx.beginPath();
				ctx.arc(sn.x, sn.y, sn.radius + 2, 0, Math.PI * 2);
				ctx.stroke();
			}

			if (isHovered) {
				ctx.globalAlpha = 1;
				ctx.strokeStyle = "rgba(255, 200, 120, 0.95)";
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.arc(sn.x, sn.y, sn.radius + 3, 0, Math.PI * 2);
				ctx.stroke();
			}

			const showLabel = matches && (isHovered || (sn.node.isHub && this.plugin.settings.brainView.showLabelsForHubsOnly) || (!this.plugin.settings.brainView.showLabelsForHubsOnly && this.camera.zoom > 2.2));
			if (showLabel) {
				ctx.globalAlpha = 1;
				ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
				ctx.font = "11px var(--font-interface, sans-serif)";
				ctx.fillText(sn.node.file.basename, sn.x + sn.radius + 4, sn.y + 3);
			}
		}
		ctx.globalAlpha = 1;
	}
}
