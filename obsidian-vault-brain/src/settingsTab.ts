import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type VaultBrainPlugin from "./main";
import { BrainKind, BrainRegion } from "./settings";

function parseFolderList(raw: string): string[] {
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

const KNOWN_KINDS: BrainKind[] = [
	"person",
	"project",
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
const KNOWN_REGIONS: BrainRegion[] = ["frontal", "parietal", "temporal", "occipital", "cerebellum", "stem"];

function serializeMap(map: Record<string, string>): string {
	return Object.entries(map)
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n");
}

/** Parses "key: value" lines into a map, dropping (and warning about) values that aren't one of `allowed`. */
function parseMap<T extends string>(raw: string, allowed: readonly T[]): Record<string, T> {
	const map: Record<string, T> = {};
	const dropped: string[] = [];
	for (const line of raw.split("\n")) {
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		if (!key || !value) continue;
		if ((allowed as readonly string[]).includes(value)) map[key] = value as T;
		else dropped.push(`${key}: ${value}`);
	}
	if (dropped.length > 0) new Notice(`Vault Brain: ignored unrecognized value(s): ${dropped.join(", ")}`);
	return map;
}

export class VaultBrainSettingTab extends PluginSettingTab {
	plugin: VaultBrainPlugin;

	constructor(app: App, plugin: VaultBrainPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;

		containerEl.createEl("h2", { text: "Vault Brain" });
		containerEl.createEl("p", {
			text: "Auto-files notes by date, auto-links your vault into a connected second brain, and runs a housekeeping bot to keep it tidy.",
		});

		// ---------------------------------------------------------------- Date organization
		containerEl.createEl("h3", { text: "Date organization" });

		new Setting(containerEl)
			.setName("Enable date organization")
			.setDesc("Turns on the 'Organize by date' commands.")
			.addToggle((t) =>
				t.setValue(settings.dateOrganization.enabled).onChange(async (v) => {
					settings.dateOrganization.enabled = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Auto-organize new notes")
			.setDesc("Automatically file a note into its date folder as soon as it's created.")
			.addToggle((t) =>
				t.setValue(settings.dateOrganization.autoOrganizeOnCreate).onChange(async (v) => {
					settings.dateOrganization.autoOrganizeOnCreate = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Date source")
			.setDesc("Where to read a note's date from.")
			.addDropdown((d) =>
				d
					.addOptions({ frontmatter: "Frontmatter property", created: "File created time", filename: "Date in file name" })
					.setValue(settings.dateOrganization.dateSource)
					.onChange(async (v) => {
						settings.dateOrganization.dateSource = v as typeof settings.dateOrganization.dateSource;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Frontmatter date property")
			.setDesc("Used when date source is 'Frontmatter property'.")
			.addText((t) =>
				t.setValue(settings.dateOrganization.frontmatterKey).onChange(async (v) => {
					settings.dateOrganization.frontmatterKey = v || "date";
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Folder pattern")
			.setDesc("Moment.js tokens, e.g. Journal/YYYY/MM-MMMM")
			.addText((t) =>
				t.setValue(settings.dateOrganization.folderPattern).onChange(async (v) => {
					settings.dateOrganization.folderPattern = v || "Journal/YYYY/MM-MMMM";
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Rename file to date")
			.setDesc("Also rename the note itself using the file name pattern below (off = keep the existing title).")
			.addToggle((t) =>
				t.setValue(settings.dateOrganization.renameFile).onChange(async (v) => {
					settings.dateOrganization.renameFile = v;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		if (settings.dateOrganization.renameFile) {
			new Setting(containerEl)
				.setName("File name pattern")
				.setDesc("Moment.js tokens, e.g. YYYY-MM-DD")
				.addText((t) =>
					t.setValue(settings.dateOrganization.fileNamePattern).onChange(async (v) => {
						settings.dateOrganization.fileNamePattern = v || "YYYY-MM-DD";
						await this.plugin.saveSettings();
					})
				);
		}

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc("Comma-separated list of folders to never move notes into/out of.")
			.addText((t) =>
				t.setValue(settings.dateOrganization.excludeFolders.join(", ")).onChange(async (v) => {
					settings.dateOrganization.excludeFolders = parseFolderList(v);
					await this.plugin.saveSettings();
				})
			);

		// ---------------------------------------------------------------- Auto-linking
		containerEl.createEl("h3", { text: "Auto-linking (massive brain)" });

		new Setting(containerEl)
			.setName("Enable auto-linking")
			.setDesc("Turns on the auto-link and related-notes commands.")
			.addToggle((t) =>
				t.setValue(settings.autoLinking.enabled).onChange(async (v) => {
					settings.autoLinking.enabled = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Minimum word length")
			.setDesc("Titles/aliases shorter than this are ignored, to avoid linking common short words.")
			.addSlider((s) =>
				s
					.setLimits(2, 12, 1)
					.setValue(settings.autoLinking.minWordLength)
					.setDynamicTooltip()
					.onChange(async (v) => {
						settings.autoLinking.minWordLength = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Case sensitive matching")
			.addToggle((t) =>
				t.setValue(settings.autoLinking.caseSensitive).onChange(async (v) => {
					settings.autoLinking.caseSensitive = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Use aliases")
			.setDesc("Also match a note's frontmatter 'aliases'.")
			.addToggle((t) =>
				t.setValue(settings.autoLinking.useAliases).onChange(async (v) => {
					settings.autoLinking.useAliases = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Link first occurrence only")
			.setDesc("Only turn the first mention of each note into a link per note, instead of every mention.")
			.addToggle((t) =>
				t.setValue(settings.autoLinking.linkFirstOccurrenceOnly).onChange(async (v) => {
					settings.autoLinking.linkFirstOccurrenceOnly = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc("Comma-separated list of folders to ignore for matching and linking.")
			.addText((t) =>
				t.setValue(settings.autoLinking.excludeFolders.join(", ")).onChange(async (v) => {
					settings.autoLinking.excludeFolders = parseFolderList(v);
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Add 'Related Notes' section")
			.setDesc("Appends a managed, auto-updating list of related notes to the bottom of a note.")
			.addToggle((t) =>
				t.setValue(settings.autoLinking.addRelatedNotesSection).onChange(async (v) => {
					settings.autoLinking.addRelatedNotesSection = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Related notes heading")
			.addText((t) =>
				t.setValue(settings.autoLinking.relatedNotesHeading).onChange(async (v) => {
					settings.autoLinking.relatedNotesHeading = v || "Related Notes";
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Related notes count")
			.addSlider((s) =>
				s
					.setLimits(1, 15, 1)
					.setValue(settings.autoLinking.relatedNotesCount)
					.setDynamicTooltip()
					.onChange(async (v) => {
						settings.autoLinking.relatedNotesCount = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Similarity method")
			.setDesc("How related notes are ranked: shared tags, shared graph connections, or both.")
			.addDropdown((d) =>
				d
					.addOptions({ tags: "Shared tags", links: "Shared connections", both: "Both (average)" })
					.setValue(settings.autoLinking.similarityMethod)
					.onChange(async (v) => {
						settings.autoLinking.similarityMethod = v as typeof settings.autoLinking.similarityMethod;
						await this.plugin.saveSettings();
					})
			);

		// ---------------------------------------------------------------- Housekeeping
		containerEl.createEl("h3", { text: "Housekeeping bot" });

		new Setting(containerEl)
			.setName("Enable housekeeping")
			.addToggle((t) =>
				t.setValue(settings.housekeeping.enabled).onChange(async (v) => {
					settings.housekeeping.enabled = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Run scan on startup")
			.addToggle((t) =>
				t.setValue(settings.housekeeping.runOnStartup).onChange(async (v) => {
					settings.housekeeping.runOnStartup = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Scan interval (hours)")
			.setDesc("0 disables automatic periodic scans; you can still run one manually from the command palette.")
			.addSlider((s) =>
				s
					.setLimits(0, 168, 1)
					.setValue(settings.housekeeping.intervalHours)
					.setDynamicTooltip()
					.onChange(async (v) => {
						settings.housekeeping.intervalHours = v;
						await this.plugin.saveSettings();
						this.plugin.rescheduleHousekeeping();
					})
			);

		new Setting(containerEl)
			.setName("Stale note threshold (days)")
			.addSlider((s) =>
				s
					.setLimits(7, 365, 1)
					.setValue(settings.housekeeping.staleDaysThreshold)
					.setDynamicTooltip()
					.onChange(async (v) => {
						settings.housekeeping.staleDaysThreshold = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Report folder")
			.addText((t) =>
				t.setValue(settings.housekeeping.reportFolder).onChange(async (v) => {
					settings.housekeeping.reportFolder = v || "Housekeeping";
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc("Comma-separated list of folders to skip when scanning.")
			.addText((t) =>
				t.setValue(settings.housekeeping.excludeFolders.join(", ")).onChange(async (v) => {
					settings.housekeeping.excludeFolders = parseFolderList(v);
					await this.plugin.saveSettings();
				})
			);

		containerEl.createEl("h4", { text: "Checks to run" });
		const checks = settings.housekeeping.checks;
		const checkLabels: [keyof typeof checks, string, string][] = [
			["orphans", "Orphan notes", "Notes with no links in or out."],
			["brokenLinks", "Broken links", "Links pointing at notes that don't exist."],
			["emptyNotes", "Empty notes", "Notes with little or no content."],
			["duplicateTitles", "Duplicate titles", "Different notes sharing a file name."],
			["staleNotes", "Stale notes", "Notes untouched past the threshold above."],
			["untaggedNotes", "Untagged notes", "Notes with no tags."],
		];
		for (const [key, name, desc] of checkLabels) {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addToggle((t) =>
					t.setValue(checks[key]).onChange(async (v) => {
						checks[key] = v;
						await this.plugin.saveSettings();
					})
				);
		}

		// ---------------------------------------------------------------- Brain view
		containerEl.createEl("h3", { text: "Brain view" });
		containerEl.createEl("p", {
			text: "Renders your vault as a lobed brain map: notes are classified into a kind and a lobe, sized by how connected they are, and linked by your vault's real wikilinks.",
		});

		const brainView = settings.brainView;

		new Setting(containerEl)
			.setName("Palette")
			.addDropdown((d) =>
				d
					.addOptions({ theme: "Match Obsidian theme", bio: "Bio (saturated)", mono: "Monochrome" })
					.setValue(brainView.palette)
					.onChange(async (v) => {
						brainView.palette = v as typeof brainView.palette;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Click action")
			.setDesc("What clicking a node does.")
			.addDropdown((d) =>
				d
					.addOptions({ current: "Open in current pane", newTab: "Open in new tab", preview: "Hover preview" })
					.setValue(brainView.clickAction)
					.onChange(async (v) => {
						brainView.clickAction = v as typeof brainView.clickAction;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Hub threshold (%)")
			.setDesc(
				"Notes with at least this percent of the vault's most-connected note's link count are drawn as hubs (ringed, always labeled)."
			)
			.addSlider((s) =>
				s
					.setLimits(1, 50, 1)
					.setValue(brainView.hubThresholdPercent)
					.setDynamicTooltip()
					.onChange(async (v) => {
						brainView.hubThresholdPercent = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Node cap")
			.setDesc("Maximum notes rendered. Large vaults may need this lowered for smooth panning.")
			.addSlider((s) =>
				s
					.setLimits(100, 5000, 100)
					.setValue(brainView.nodeCap)
					.setDynamicTooltip()
					.onChange(async (v) => {
						brainView.nodeCap = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Only label hub notes")
			.setDesc("Off shows labels for every note once you zoom in close enough.")
			.addToggle((t) =>
				t.setValue(brainView.showLabelsForHubsOnly).onChange(async (v) => {
					brainView.showLabelsForHubsOnly = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Idle pulse")
			.setDesc(
				"Subtle breathing glow on hub notes while the view is open. Off by default to keep it CPU/battery-cheap at rest."
			)
			.addToggle((t) =>
				t.setValue(brainView.idlePulse).onChange(async (v) => {
					brainView.idlePulse = v;
					await this.plugin.saveSettings();
				})
			);

		containerEl.createEl("h4", { text: "Classification rules" });
		containerEl.createEl("p", {
			text: "One rule per line, as 'key: value'. Folder rules match a note's path (longest match wins); tag rules match any of the note's tags or a matching frontmatter kind/type/category/region value. A note's lobe defaults to a sensible one for its kind if no region rule matches.",
		});

		new Setting(containerEl)
			.setName("Folder → kind")
			.addTextArea((t) => {
				t.setValue(serializeMap(brainView.folderKindMap)).onChange(async (v) => {
					brainView.folderKindMap = parseMap(v, KNOWN_KINDS);
					await this.plugin.saveSettings();
				});
				t.inputEl.rows = 4;
			});

		new Setting(containerEl)
			.setName("Tag → kind")
			.addTextArea((t) => {
				t.setValue(serializeMap(brainView.tagKindMap)).onChange(async (v) => {
					brainView.tagKindMap = parseMap(v, KNOWN_KINDS);
					await this.plugin.saveSettings();
				});
				t.inputEl.rows = 4;
			});

		new Setting(containerEl)
			.setName("Folder → lobe")
			.addTextArea((t) => {
				t.setValue(serializeMap(brainView.folderRegionMap)).onChange(async (v) => {
					brainView.folderRegionMap = parseMap(v, KNOWN_REGIONS);
					await this.plugin.saveSettings();
				});
				t.inputEl.rows = 3;
			});

		new Setting(containerEl)
			.setName("Tag → lobe")
			.addTextArea((t) => {
				t.setValue(serializeMap(brainView.tagRegionMap)).onChange(async (v) => {
					brainView.tagRegionMap = parseMap(v, KNOWN_REGIONS);
					await this.plugin.saveSettings();
				});
				t.inputEl.rows = 3;
			});
	}
}
