export type DateSource = "frontmatter" | "created" | "filename";
export type SimilarityMethod = "tags" | "links" | "both";

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

export interface BrainViewSettings {
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
}

export interface DateOrganizationSettings {
	enabled: boolean;
	autoOrganizeOnCreate: boolean;
	folderPattern: string;
	fileNamePattern: string;
	renameFile: boolean;
	dateSource: DateSource;
	frontmatterKey: string;
	filenameDateRegex: string;
	excludeFolders: string[];
}

export interface AutoLinkingSettings {
	enabled: boolean;
	minWordLength: number;
	caseSensitive: boolean;
	useAliases: boolean;
	linkFirstOccurrenceOnly: boolean;
	excludeFolders: string[];
	addRelatedNotesSection: boolean;
	relatedNotesHeading: string;
	relatedNotesCount: number;
	similarityMethod: SimilarityMethod;
}

export interface HousekeepingChecks {
	orphans: boolean;
	brokenLinks: boolean;
	emptyNotes: boolean;
	duplicateTitles: boolean;
	staleNotes: boolean;
	untaggedNotes: boolean;
}

export interface HousekeepingSettings {
	enabled: boolean;
	staleDaysThreshold: number;
	emptyNoteMaxChars: number;
	runOnStartup: boolean;
	intervalHours: number;
	reportFolder: string;
	excludeFolders: string[];
	checks: HousekeepingChecks;
}

export interface VaultBrainSettings {
	dateOrganization: DateOrganizationSettings;
	autoLinking: AutoLinkingSettings;
	housekeeping: HousekeepingSettings;
	brainView: BrainViewSettings;
}

export const DEFAULT_SETTINGS: VaultBrainSettings = {
	dateOrganization: {
		enabled: true,
		autoOrganizeOnCreate: false,
		folderPattern: "Journal/YYYY/MM-MMMM",
		fileNamePattern: "YYYY-MM-DD",
		renameFile: false,
		dateSource: "created",
		frontmatterKey: "date",
		filenameDateRegex: "(\\d{4})-(\\d{2})-(\\d{2})",
		excludeFolders: ["Housekeeping", "Templates"],
	},
	autoLinking: {
		enabled: true,
		minWordLength: 4,
		caseSensitive: false,
		useAliases: true,
		linkFirstOccurrenceOnly: true,
		excludeFolders: ["Housekeeping", "Templates"],
		addRelatedNotesSection: true,
		relatedNotesHeading: "Related Notes",
		relatedNotesCount: 5,
		similarityMethod: "both",
	},
	housekeeping: {
		enabled: true,
		staleDaysThreshold: 90,
		emptyNoteMaxChars: 5,
		runOnStartup: false,
		intervalHours: 24,
		reportFolder: "Housekeeping",
		excludeFolders: ["Housekeeping", "Templates"],
		checks: {
			orphans: true,
			brokenLinks: true,
			emptyNotes: true,
			duplicateTitles: true,
			staleNotes: true,
			untaggedNotes: false,
		},
	},
	brainView: {
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
	},
};
