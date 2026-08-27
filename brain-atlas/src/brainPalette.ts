import { BrainKind, BrainPalette, BrainRegion } from "./settings";

const KIND_ORDER: BrainKind[] = [
	"project",
	"person",
	"concept",
	"source",
	"dailyNote",
	"question",
	"decision",
	"tool",
	"workThread",
	"index",
	"note",
];

/** Hues (0-360) shared by every palette so a kind keeps a stable identity; palettes differ in
 *  saturation/lightness, not hue assignment. */
const KIND_HUES: Record<BrainKind, number> = {
	project: 210,
	person: 330,
	concept: 265,
	source: 40,
	dailyNote: 150,
	question: 190,
	decision: 15,
	tool: 95,
	workThread: 245,
	index: 55,
	note: 0,
};

function hsl(h: number, s: number, l: number, a = 1): string {
	return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

export function kindColor(kind: BrainKind, palette: BrainPalette): string {
	// "note" is the catch-all for anything matching no kind/region rule, which is often most of a
	// vault. Render it as muted background tissue rather than a saturated color competing with the
	// kinds someone actually chose to classify.
	if (kind === "note") return hsl(220, 8, palette === "mono" ? 50 : 58, 0.55);
	const hue = KIND_HUES[kind];
	if (palette === "bio") return hsl(hue, 70, 58);
	if (palette === "mono") return hsl(hue, 12, 62);
	// "theme": desaturated so nodes read as an extension of Obsidian's own UI, not a foreign overlay.
	return hsl(hue, 55, 62);
}

export function kindLegend(): { kind: BrainKind; label: string }[] {
	const labels: Record<BrainKind, string> = {
		project: "Project",
		person: "Person",
		concept: "Concept",
		source: "Source",
		dailyNote: "Daily note",
		question: "Question",
		decision: "Decision",
		tool: "Tool",
		workThread: "Work thread",
		index: "Index",
		note: "Note",
	};
	return KIND_ORDER.map((kind) => ({ kind, label: labels[kind] }));
}

export function regionLabel(region: BrainRegion): string {
	const labels: Record<BrainRegion, string> = {
		frontal: "Frontal — projects & decisions",
		parietal: "Parietal — concepts & questions",
		temporal: "Temporal — people",
		occipital: "Occipital — sources",
		cerebellum: "Cerebellum — tools & indexes",
		stem: "Stem — daily notes",
	};
	return labels[region];
}
