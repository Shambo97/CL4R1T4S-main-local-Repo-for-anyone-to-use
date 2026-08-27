export type BrainKind =
	| "person"
	| "project"
	| "concept"
	| "source"
	| "dailyNote"
	| "question"
	| "decision"
	| "tool"
	| "workThread"
	| "index"
	| "note";

export type BrainRegion = "frontal" | "parietal" | "temporal" | "occipital" | "cerebellum" | "stem";
export type BrainClickAction = "current" | "newTab" | "preview";
export type BrainPalette = "theme" | "bio" | "mono";

/** A pinned node's position, as a fraction (0..1) of the brain silhouette's bounding box — portable
 *  across window sizes and zoom levels, unlike raw pixel/world coordinates. */
export interface PinnedPosition {
	x: number;
	y: number;
}

export interface BrainAtlasSettings {
	palette: BrainPalette;
	nodeCap: number;
	hubThresholdPercent: number;
	clickAction: BrainClickAction;
	showLabelsForHubsOnly: boolean;
	idlePulse: boolean;
	enabledRegions: Record<BrainRegion, boolean>;
	folderKindMap: Record<string, BrainKind>;
	tagKindMap: Record<string, BrainKind>;
	folderRegionMap: Record<string, BrainRegion>;
	tagRegionMap: Record<string, BrainRegion>;
	pinnedNodePositions: Record<string, PinnedPosition>;
}

export const DEFAULT_SETTINGS: BrainAtlasSettings = {
	palette: "theme",
	nodeCap: 1500,
	hubThresholdPercent: 4,
	clickAction: "current",
	showLabelsForHubsOnly: true,
	idlePulse: false,
	enabledRegions: {
		frontal: true,
		parietal: true,
		temporal: true,
		occipital: true,
		cerebellum: true,
		stem: true,
	},
	folderKindMap: {
		People: "person",
		Projects: "project",
		Sources: "source",
		Daily: "dailyNote",
		Journal: "dailyNote",
		Concepts: "concept",
		Topics: "concept",
		MOCs: "concept",
		Maps: "concept",
		Index: "index",
		Home: "index",
	},
	tagKindMap: {
		project: "project",
		person: "person",
		decision: "decision",
		question: "question",
		tool: "tool",
		concept: "concept",
		source: "source",
		daily: "dailyNote",
		moc: "concept",
		thread: "workThread",
		index: "index",
	},
	folderRegionMap: {},
	tagRegionMap: {},
	pinnedNodePositions: {},
};
