import { App, PluginSettingTab, Setting, moment } from "obsidian";
import type VaultBrainPlugin from "./main";

/**
 * Renders a live "resolves to" preview under a moment.js pattern field, using today's date. Catches
 * the single most common mistake with these patterns: unbracketed literal words. In moment.js, only
 * text wrapped in [brackets] is literal — every other letter is a format token, so a pattern like
 * "Journal/YYYY" silently reads "Journal" as tokens (its "a" means am/pm, its "l" means localized
 * date) instead of the folder name you meant. Wrap literal words in brackets, e.g. "[Journal]/YYYY".
 */
function renderPatternPreview(container: HTMLElement, getPattern: () => string): { refresh: () => void } {
	const preview = container.createDiv({ cls: "setting-item-description" });
	const refresh = () => {
		const pattern = getPattern();
		let resolved: string;
		try {
			resolved = moment().format(pattern);
		} catch {
			resolved = "(invalid pattern)";
		}
		preview.empty();
		preview.createSpan({ text: "Resolves to: " });
		preview.createEl("code", { text: resolved || "(empty)" });
	};
	refresh();
	return { refresh };
}

function parseFolderList(raw: string): string[] {
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
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

		const folderPatternSetting = new Setting(containerEl)
			.setName("Folder pattern")
			.setDesc("Moment.js tokens. Wrap literal words in [brackets], e.g. [Journal]/YYYY/MM-MMMM — see the live preview below.");
		let folderPreview: { refresh: () => void };
		folderPatternSetting.addText((t) =>
			t.setValue(settings.dateOrganization.folderPattern).onChange(async (v) => {
				settings.dateOrganization.folderPattern = v || "[Journal]/YYYY/MM-MMMM";
				await this.plugin.saveSettings();
				folderPreview.refresh();
			})
		);
		folderPreview = renderPatternPreview(containerEl, () => settings.dateOrganization.folderPattern);

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
			const fileNamePatternSetting = new Setting(containerEl)
				.setName("File name pattern")
				.setDesc("Moment.js tokens. Wrap literal words in [brackets] — see the live preview below.");
			let fileNamePreview: { refresh: () => void };
			fileNamePatternSetting.addText((t) =>
				t.setValue(settings.dateOrganization.fileNamePattern).onChange(async (v) => {
					settings.dateOrganization.fileNamePattern = v || "YYYY-MM-DD";
					await this.plugin.saveSettings();
					fileNamePreview.refresh();
				})
			);
			fileNamePreview = renderPatternPreview(containerEl, () => settings.dateOrganization.fileNamePattern);
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
			.setDesc(
				"How related notes are ranked. 'Shared keywords' works even when notes have no tags or links yet, so it's the one that matters most for a fresh vault."
			)
			.addDropdown((d) =>
				d
					.addOptions({
						tags: "Shared tags",
						links: "Shared connections",
						content: "Shared keywords",
						both: "All signals (recommended)",
					})
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
	}
}
