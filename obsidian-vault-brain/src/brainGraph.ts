import { App, TFile } from "obsidian";
import { BrainKind, BrainRegion, BrainViewSettings } from "./settings";

export interface BrainNode {
	file: TFile;
	kind: BrainKind;
	region: BrainRegion;
	degree: number;
	isHub: boolean;
}

export interface BrainEdge {
	source: string;
	target: string;
}

export interface BrainGraph {
	nodes: BrainNode[];
	edges: BrainEdge[];
	maxDegree: number;
}

const REGIONS: BrainRegion[] = ["frontal", "parietal", "temporal", "occipital", "cerebellum", "stem"];

/** Default lobe a kind lands in when no explicit region rule matches, chosen for a loose neuroscience fit:
 *  frontal = planning/decisions, parietal = integration, temporal = people/memory,
 *  occipital = source material ("input"), cerebellum = procedural/reference, stem = routine. */
const KIND_TO_REGION: Record<BrainKind, BrainRegion> = {
	project: "frontal",
	decision: "frontal",
	workThread: "frontal",
	question: "parietal",
	concept: "parietal",
	note: "parietal",
	person: "temporal",
	dailyNote: "stem",
	source: "occipital",
	tool: "cerebellum",
	index: "cerebellum",
};

function getNoteTags(app: App, file: TFile): Set<string> {
	const cache = app.metadataCache.getFileCache(file);
	const tags = new Set<string>();
	for (const t of cache?.tags ?? []) tags.add(t.tag.replace(/^#/, "").toLowerCase());
	const fmTags = cache?.frontmatter?.tags;
	if (Array.isArray(fmTags)) fmTags.forEach((t) => typeof t === "string" && tags.add(t.replace(/^#/, "").toLowerCase()));
	else if (typeof fmTags === "string") fmTags.split(",").forEach((t) => tags.add(t.trim().replace(/^#/, "").toLowerCase()));
	return tags;
}

/** Longest matching folder prefix wins, so a more specific rule (e.g. "Projects/Archive") beats a broader one ("Projects"). */
function matchByFolderPrefix<T>(path: string, map: Record<string, T>): T | undefined {
	let best: { length: number; value: T } | undefined;
	for (const folder of Object.keys(map)) {
		const normalized = folder.replace(/\/+$/, "");
		if (!normalized) continue;
		if (path === normalized || path.startsWith(normalized + "/")) {
			if (!best || normalized.length > best.length) best = { length: normalized.length, value: map[folder] };
		}
	}
	return best?.value;
}

function classifyKind(app: App, file: TFile, settings: BrainViewSettings): BrainKind {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	for (const key of ["kind", "type", "category"]) {
		const raw = frontmatter?.[key];
		if (typeof raw === "string") {
			const match = settings.tagKindMap[raw.trim().toLowerCase()];
			if (match) return match;
		}
	}
	for (const tag of getNoteTags(app, file)) {
		const match = settings.tagKindMap[tag];
		if (match) return match;
	}
	const folderMatch = matchByFolderPrefix(file.path, settings.folderKindMap);
	if (folderMatch) return folderMatch;
	return "note";
}

function isBrainRegion(value: string): value is BrainRegion {
	return (REGIONS as string[]).includes(value);
}

function classifyRegion(app: App, file: TFile, kind: BrainKind, settings: BrainViewSettings): BrainRegion {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const explicit = frontmatter?.brain_region ?? frontmatter?.region ?? frontmatter?.lobe;
	if (typeof explicit === "string" && isBrainRegion(explicit.trim().toLowerCase())) {
		return explicit.trim().toLowerCase() as BrainRegion;
	}
	for (const tag of getNoteTags(app, file)) {
		const match = settings.tagRegionMap[tag];
		if (match) return match;
	}
	const folderMatch = matchByFolderPrefix(file.path, settings.folderRegionMap);
	if (folderMatch) return folderMatch;
	return KIND_TO_REGION[kind];
}

/** Builds the note graph straight from Obsidian's own resolved-link index, so the map always matches
 *  the vault's real connections instead of a separately maintained shadow graph. */
export function buildBrainGraph(app: App, settings: BrainViewSettings): BrainGraph {
	const files = app.vault.getMarkdownFiles().slice(0, Math.max(0, settings.nodeCap));
	const nodes: BrainNode[] = files.map((file) => {
		const kind = classifyKind(app, file, settings);
		const region = classifyRegion(app, file, kind, settings);
		return { file, kind, region, degree: 0, isHub: false };
	});

	const included = new Set(nodes.map((n) => n.file.path));
	const degree = new Map<string, number>();
	const edges: BrainEdge[] = [];
	const resolved = app.metadataCache.resolvedLinks;

	for (const [source, targets] of Object.entries(resolved)) {
		if (!included.has(source)) continue;
		for (const target of Object.keys(targets)) {
			if (target === source || !included.has(target)) continue;
			edges.push({ source, target });
			degree.set(source, (degree.get(source) ?? 0) + 1);
			degree.set(target, (degree.get(target) ?? 0) + 1);
		}
	}

	let maxDegree = 0;
	for (const d of degree.values()) if (d > maxDegree) maxDegree = d;
	const hubThreshold = maxDegree * (settings.hubThresholdPercent / 100);

	for (const node of nodes) {
		node.degree = degree.get(node.file.path) ?? 0;
		node.isHub = node.degree > 0 && node.degree >= hubThreshold;
	}

	return { nodes, edges, maxDegree };
}
