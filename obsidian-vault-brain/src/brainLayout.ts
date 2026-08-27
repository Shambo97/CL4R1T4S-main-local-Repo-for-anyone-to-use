import { BrainNode } from "./brainGraph";
import { BrainRegion } from "./settings";

export interface LayoutPoint {
	x: number;
	y: number;
}

/** Relative anchors (0..1 of the brain silhouette's bounding box) for each lobe, arranged as a rough
 *  left-facing side profile: frontal at front-top, occipital at the back, cerebellum tucked under it,
 *  the brainstem hanging off the bottom-back, temporal along the lower-middle, parietal crowning the top. */
const REGION_ANCHORS: Record<BrainRegion, { cx: number; cy: number; r: number }> = {
	frontal: { cx: 0.26, cy: 0.38, r: 0.22 },
	parietal: { cx: 0.55, cy: 0.2, r: 0.19 },
	occipital: { cx: 0.83, cy: 0.34, r: 0.15 },
	temporal: { cx: 0.44, cy: 0.68, r: 0.2 },
	cerebellum: { cx: 0.78, cy: 0.7, r: 0.13 },
	stem: { cx: 0.62, cy: 0.92, r: 0.07 },
};

/** Small deterministic string hash so a note's position is stable across re-renders/sessions
 *  without having to persist coordinates anywhere. */
function hashString(input: string): number {
	let h = 2166136261;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0) / 4294967295;
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Places every node inside its lobe's anchor circle (uniform disk sample seeded from the note's path),
 *  then runs a few cheap pairwise-repulsion passes within each lobe so notes fan out instead of clumping.
 *  Repulsion is skipped past `relaxCap` nodes since it's O(n^2) per lobe and canvas redraw is already
 *  the bottleneck at that scale. */
export function layoutBrainNodes(nodes: BrainNode[], relaxCap = 260): Map<string, LayoutPoint> {
	const positions = new Map<string, LayoutPoint>();
	const byRegion = new Map<BrainRegion, BrainNode[]>();
	for (const node of nodes) {
		if (!byRegion.has(node.region)) byRegion.set(node.region, []);
		byRegion.get(node.region)!.push(node);
	}

	for (const [region, regionNodes] of byRegion) {
		const anchor = REGION_ANCHORS[region];
		const local = regionNodes.map((node) => {
			const rand = mulberry32(Math.floor(hashString(node.file.path) * 4294967295));
			const angle = rand() * Math.PI * 2;
			const radius = Math.sqrt(rand()) * anchor.r * 0.92;
			return { node, x: anchor.cx + Math.cos(angle) * radius, y: anchor.cy + Math.sin(angle) * radius };
		});

		if (local.length <= relaxCap) {
			const minDist = Math.min(0.03, anchor.r / Math.sqrt(Math.max(local.length, 1)) / 1.6);
			for (let pass = 0; pass < 24; pass++) {
				for (let i = 0; i < local.length; i++) {
					for (let j = i + 1; j < local.length; j++) {
						const a = local[i];
						const b = local[j];
						const dx = b.x - a.x;
						const dy = b.y - a.y;
						const dist = Math.hypot(dx, dy) || 0.0001;
						if (dist >= minDist) continue;
						const push = (minDist - dist) / dist / 2;
						const ox = dx * push;
						const oy = dy * push;
						a.x -= ox;
						a.y -= oy;
						b.x += ox;
						b.y += oy;
					}
				}
				for (const p of local) {
					const dx = p.x - anchor.cx;
					const dy = p.y - anchor.cy;
					const dist = Math.hypot(dx, dy);
					if (dist > anchor.r) {
						const scale = anchor.r / dist;
						p.x = anchor.cx + dx * scale;
						p.y = anchor.cy + dy * scale;
					}
				}
			}
		}

		for (const p of local) positions.set(p.node.file.path, { x: p.x, y: p.y });
	}

	return positions;
}

export function regionAnchor(region: BrainRegion): { cx: number; cy: number; r: number } {
	return REGION_ANCHORS[region];
}

export function allRegionAnchors(): Record<BrainRegion, { cx: number; cy: number; r: number }> {
	return REGION_ANCHORS;
}
