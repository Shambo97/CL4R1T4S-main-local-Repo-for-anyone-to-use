import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type BrainAtlasPlugin from "./main";
import { BrainKind, BrainRegion } from "./settings";

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
	if (dropped.length > 0) new Notice(`Brain Atlas: ignored unrecognized value(s): ${dropped.join(", ")}`);
	return map;
}

export class BrainAtlasSettingTab extends PluginSettingTab {
	plugin: BrainAtlasPlugin;

	constructor(app: App, plugin: BrainAtlasPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;

		containerEl.createEl("h2", { text: "Brain Atlas" });
		containerEl.createEl("p", {
			text: "Renders your vault as a lobed brain map: notes are classified into a kind and a lobe, sized by how connected they are, and linked by your vault's real wikilinks. Drag a note to pin it wherever you like.",
		});

		new Setting(containerEl)
			.setName("Palette")
			.addDropdown((d) =>
				d
					.addOptions({ theme: "Match Obsidian theme", bio: "Bio (saturated)", mono: "Monochrome" })
					.setValue(settings.palette)
					.onChange(async (v) => {
						settings.palette = v as typeof settings.palette;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Click action")
			.setDesc("What clicking a node does.")
			.addDropdown((d) =>
				d
					.addOptions({ current: "Open in current pane", newTab: "Open in new tab", preview: "Hover preview" })
					.setValue(settings.clickAction)
					.onChange(async (v) => {
						settings.clickAction = v as typeof settings.clickAction;
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
					.setValue(settings.hubThresholdPercent)
					.setDynamicTooltip()
					.onChange(async (v) => {
						settings.hubThresholdPercent = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Node cap")
			.setDesc("Maximum notes rendered. Large vaults may need this lowered for smooth panning.")
			.addSlider((s) =>
				s
					.setLimits(100, 5000, 100)
					.setValue(settings.nodeCap)
					.setDynamicTooltip()
					.onChange(async (v) => {
						settings.nodeCap = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Only label hub notes")
			.setDesc("Off shows labels for every note once you zoom in close enough.")
			.addToggle((t) =>
				t.setValue(settings.showLabelsForHubsOnly).onChange(async (v) => {
					settings.showLabelsForHubsOnly = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Idle pulse")
			.setDesc(
				"Subtle breathing glow on hub notes while the view is open. Off by default to keep it CPU/battery-cheap at rest."
			)
			.addToggle((t) =>
				t.setValue(settings.idlePulse).onChange(async (v) => {
					settings.idlePulse = v;
					await this.plugin.saveSettings();
				})
			);

		const pinnedCount = Object.keys(settings.pinnedNodePositions).length;
		new Setting(containerEl)
			.setName("Pinned notes")
			.setDesc(
				pinnedCount === 0
					? "No notes are pinned yet. Drag a note in the Brain Atlas view to pin it in place."
					: `${pinnedCount} note(s) pinned to a custom position. Right-click a pinned note in the view to unpin it individually.`
			)
			.addButton((b) =>
				b
					.setButtonText("Clear all pinned positions")
					.setDisabled(pinnedCount === 0)
					.onClick(async () => {
						settings.pinnedNodePositions = {};
						await this.plugin.saveSettings();
						new Notice("Brain Atlas: cleared all pinned positions.");
						this.display();
					})
			);

		containerEl.createEl("h3", { text: "Classification rules" });
		containerEl.createEl("p", {
			text: "One rule per line, as 'key: value'. Folder rules match a note's path (longest match wins); tag rules match any of the note's tags or a matching frontmatter kind/type/category/region value. A note's lobe defaults to a sensible one for its kind if no region rule matches.",
		});

		new Setting(containerEl)
			.setName("Folder → kind")
			.addTextArea((t) => {
				t.setValue(serializeMap(settings.folderKindMap)).onChange(async (v) => {
					settings.folderKindMap = parseMap(v, KNOWN_KINDS);
					await this.plugin.saveSettings();
				});
				t.inputEl.rows = 4;
			});

		new Setting(containerEl)
			.setName("Tag → kind")
			.addTextArea((t) => {
				t.setValue(serializeMap(settings.tagKindMap)).onChange(async (v) => {
					settings.tagKindMap = parseMap(v, KNOWN_KINDS);
					await this.plugin.saveSettings();
				});
				t.inputEl.rows = 4;
			});

		new Setting(containerEl)
			.setName("Folder → lobe")
			.addTextArea((t) => {
				t.setValue(serializeMap(settings.folderRegionMap)).onChange(async (v) => {
					settings.folderRegionMap = parseMap(v, KNOWN_REGIONS);
					await this.plugin.saveSettings();
				});
				t.inputEl.rows = 3;
			});

		new Setting(containerEl)
			.setName("Tag → lobe")
			.addTextArea((t) => {
				t.setValue(serializeMap(settings.tagRegionMap)).onChange(async (v) => {
					settings.tagRegionMap = parseMap(v, KNOWN_REGIONS);
					await this.plugin.saveSettings();
				});
				t.inputEl.rows = 3;
			});
	}
}
