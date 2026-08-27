import { Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, VaultBrainSettings } from "./settings";
import { VaultBrainSettingTab } from "./settingsTab";
import { organizeNote, organizeVault } from "./dateOrganizer";
import { autoLinkContent, buildContentWordIndex, buildTitleIndex, computeRelatedNotes, upsertRelatedNotesSection } from "./autoLinker";
import { renderReportMarkdown, runHousekeepingScan, writeReport } from "./housekeeping";
import { ConfirmModal } from "./confirmModal";
import { isSpecialPluginNote } from "./utils";
import { findCorruptedFiles, folderPatternStillCorrupted, repairCorruptedDateFolders } from "./repair";
import { applyGraphColors, previewGraphGroups, type GraphGroupBy } from "./graphColor";
import { createFolderStructure } from "./scaffold";

const MILLIS_PER_HOUR = 60 * 60 * 1000;
const AUTO_ORGANIZE_DELAY_MS = 1500;

export default class VaultBrainPlugin extends Plugin {
	settings: VaultBrainSettings = DEFAULT_SETTINGS;
	private housekeepingIntervalId: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new VaultBrainSettingTab(this.app, this));

		this.addCommand({
			id: "organize-current-note-by-date",
			name: "Organize current note by date",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.organizeSingle(file);
				return true;
			},
		});

		this.addCommand({
			id: "organize-vault-by-date",
			name: "Organize entire vault by date",
			callback: () => void this.organizeAll(),
		});

		this.addCommand({
			id: "auto-link-current-note",
			name: "Auto-link current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.autoLinkSingle(file);
				return true;
			},
		});

		this.addCommand({
			id: "update-related-notes-current",
			name: "Update related notes for current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.updateRelatedSingle(file);
				return true;
			},
		});

		this.addCommand({
			id: "auto-link-vault",
			name: "Auto-link entire vault (add links + related notes)",
			callback: () => void this.autoLinkAll(),
		});

		this.addCommand({
			id: "run-housekeeping-scan",
			name: "Run vault housekeeping scan now",
			callback: () => void this.runHousekeeping(true),
		});

		this.addCommand({
			id: "repair-corrupted-date-folders",
			name: "Repair garbled date folders (Journam*/Journpm*)",
			callback: () => void this.repairCorruptedFolders(),
		});

		this.addCommand({
			id: "auto-color-graph-by-folder",
			name: "Auto-color graph by folder",
			callback: () => void this.autoColorGraph("folder"),
		});

		this.addCommand({
			id: "auto-color-graph-by-tag",
			name: "Auto-color graph by tag",
			callback: () => void this.autoColorGraph("tag"),
		});

		this.addCommand({
			id: "create-folder-structure",
			name: "Create recommended folder structure",
			callback: () => void this.createFolderStructure(),
		});

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (!(file instanceof TFile)) return;
				if (file.extension !== "md") return;
				if (!this.settings.dateOrganization.enabled || !this.settings.dateOrganization.autoOrganizeOnCreate) return;
				// Delay so templater/other plugins can finish populating the note (and its frontmatter) first.
				window.setTimeout(() => void this.organizeSingle(file, true), AUTO_ORGANIZE_DELAY_MS);
			})
		);

		this.rescheduleHousekeeping();

		if (this.settings.housekeeping.enabled && this.settings.housekeeping.runOnStartup) {
			this.app.workspace.onLayoutReady(() => void this.runHousekeeping(false));
		}
	}

	onunload(): void {
		if (this.housekeepingIntervalId !== null) {
			window.clearInterval(this.housekeepingIntervalId);
			this.housekeepingIntervalId = null;
		}
	}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<VaultBrainSettings> | null;
		this.settings = {
			dateOrganization: { ...DEFAULT_SETTINGS.dateOrganization, ...loaded?.dateOrganization },
			autoLinking: { ...DEFAULT_SETTINGS.autoLinking, ...loaded?.autoLinking },
			housekeeping: {
				...DEFAULT_SETTINGS.housekeeping,
				...loaded?.housekeeping,
				checks: { ...DEFAULT_SETTINGS.housekeeping.checks, ...loaded?.housekeeping?.checks },
			},
			graphColor: { ...DEFAULT_SETTINGS.graphColor, ...loaded?.graphColor },
			folderStructure: { ...DEFAULT_SETTINGS.folderStructure, ...loaded?.folderStructure },
		};

		// Installs from before 1.0.1 have the unescaped "Journal/YYYY/MM-MMMM" baked into their saved
		// data.json. The merge above lets saved values win over defaults, so the corrected default
		// never reaches an existing install on its own — migrate it explicitly, once.
		if (this.settings.dateOrganization.folderPattern === "Journal/YYYY/MM-MMMM") {
			this.settings.dateOrganization.folderPattern = DEFAULT_SETTINGS.dateOrganization.folderPattern;
			await this.saveSettings();
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	rescheduleHousekeeping(): void {
		if (this.housekeepingIntervalId !== null) {
			window.clearInterval(this.housekeepingIntervalId);
			this.housekeepingIntervalId = null;
		}
		const hours = this.settings.housekeeping.intervalHours;
		if (!this.settings.housekeeping.enabled || hours <= 0) return;
		this.housekeepingIntervalId = window.setInterval(() => void this.runHousekeeping(false), hours * MILLIS_PER_HOUR);
		this.registerInterval(this.housekeepingIntervalId);
	}

	// ---------------------------------------------------------------- Date organization

	private async organizeSingle(file: TFile, silent = false): Promise<void> {
		if (!this.settings.dateOrganization.enabled) return;
		const result = await organizeNote(this.app, file, this.settings.dateOrganization);
		if (!silent) {
			new Notice(result.moved ? `Moved to ${result.toPath}` : `Already organized (${result.reason ?? "no change"})`);
		}
	}

	private async organizeAll(): Promise<void> {
		if (!this.settings.dateOrganization.enabled) {
			new Notice("Vault Brain: date organization is disabled in settings.");
			return;
		}
		const confirmed = await ConfirmModal.ask(
			this.app,
			"Organize entire vault by date?",
			"This will move every eligible note into its date-based folder. Links will be kept intact automatically, but this touches many files at once. Continue?",
			"Organize vault"
		);
		if (!confirmed) return;

		const notice = new Notice("Vault Brain: organizing vault…", 0);
		const results = await organizeVault(this.app, this.settings.dateOrganization, (done, total) => {
			notice.setMessage(`Vault Brain: organizing vault… ${done}/${total}`);
		});
		notice.hide();
		const moved = results.filter((r) => r.moved).length;
		new Notice(`Vault Brain: moved ${moved} of ${results.length} notes.`);
	}

	// ---------------------------------------------------------------- Auto-linking

	private async autoLinkSingle(file: TFile): Promise<void> {
		if (!this.settings.autoLinking.enabled) return;
		if (isSpecialPluginNote(this.app, file)) {
			new Notice("Vault Brain: skipped — this is a Kanban board or Excalidraw drawing.");
			return;
		}
		const index = buildTitleIndex(this.app, this.settings.autoLinking);
		const original = await this.app.vault.read(file);
		const { content, linksAdded } = autoLinkContent(original, file, index, this.settings.autoLinking);

		let finalContent = content;
		let relatedAdded = 0;
		if (this.settings.autoLinking.addRelatedNotesSection) {
			const related = await computeRelatedNotes(this.app, file, this.settings.autoLinking);
			finalContent = upsertRelatedNotesSection(finalContent, related, this.settings.autoLinking);
			relatedAdded = related.length;
		}

		if (finalContent !== original) {
			await this.app.vault.modify(file, finalContent);
		}
		new Notice(`Vault Brain: added ${linksAdded} link(s), ${relatedAdded} related note(s).`);
	}

	private async updateRelatedSingle(file: TFile): Promise<void> {
		if (!this.settings.autoLinking.enabled) return;
		if (isSpecialPluginNote(this.app, file)) {
			new Notice("Vault Brain: skipped — this is a Kanban board or Excalidraw drawing.");
			return;
		}
		const original = await this.app.vault.read(file);
		const related = await computeRelatedNotes(this.app, file, this.settings.autoLinking);
		const updated = upsertRelatedNotesSection(original, related, this.settings.autoLinking);
		if (updated !== original) await this.app.vault.modify(file, updated);
		new Notice(`Vault Brain: found ${related.length} related note(s).`);
	}

	private async autoLinkAll(): Promise<void> {
		if (!this.settings.autoLinking.enabled) {
			new Notice("Vault Brain: auto-linking is disabled in settings.");
			return;
		}
		const confirmed = await ConfirmModal.ask(
			this.app,
			"Auto-link entire vault?",
			"This will scan every note, insert [[wikilinks]] for recognized titles, and refresh each note's Related Notes section. It edits many files at once — make sure your vault is backed up or under version control. Continue?",
			"Auto-link vault"
		);
		if (!confirmed) return;

		const files = this.app.vault.getMarkdownFiles();
		const index = buildTitleIndex(this.app, this.settings.autoLinking);
		const wordIndex = this.settings.autoLinking.addRelatedNotesSection
			? await buildContentWordIndex(this.app, this.settings.autoLinking)
			: undefined;
		const notice = new Notice("Vault Brain: linking vault…", 0);

		let totalLinks = 0;
		let notesChanged = 0;
		let done = 0;
		for (const file of files) {
			if (isSpecialPluginNote(this.app, file)) {
				done += 1;
				continue;
			}
			const original = await this.app.vault.read(file);
			const { content, linksAdded } = autoLinkContent(original, file, index, this.settings.autoLinking);

			let finalContent = content;
			if (this.settings.autoLinking.addRelatedNotesSection) {
				const related = await computeRelatedNotes(this.app, file, this.settings.autoLinking, wordIndex);
				finalContent = upsertRelatedNotesSection(finalContent, related, this.settings.autoLinking);
			}

			if (finalContent !== original) {
				await this.app.vault.modify(file, finalContent);
				notesChanged += 1;
			}
			totalLinks += linksAdded;
			done += 1;
			notice.setMessage(`Vault Brain: linking vault… ${done}/${files.length}`);
		}

		notice.hide();
		new Notice(`Vault Brain: added ${totalLinks} link(s) across ${notesChanged} note(s).`);
	}

	// ---------------------------------------------------------------- Housekeeping

	private async runHousekeeping(interactive: boolean): Promise<void> {
		if (!this.settings.housekeeping.enabled) {
			if (interactive) new Notice("Vault Brain: housekeeping is disabled in settings.");
			return;
		}
		const notice = interactive ? new Notice("Vault Brain: scanning vault…", 0) : null;
		const report = await runHousekeepingScan(this.app, this.settings.housekeeping);
		const markdown = renderReportMarkdown(report, this.settings.housekeeping);
		const reportFile = await writeReport(this.app, this.settings.housekeeping, markdown);
		notice?.hide();

		const totalIssues =
			report.orphans.length +
			report.brokenLinks.length +
			report.emptyNotes.length +
			report.duplicateTitles.length +
			report.staleNotes.length +
			report.untaggedNotes.length;

		new Notice(`Vault Brain housekeeping: ${totalIssues} issue(s) found. See ${reportFile.path}.`);
	}

	// ---------------------------------------------------------------- Repair

	private async repairCorruptedFolders(): Promise<void> {
		const affected = findCorruptedFiles(this.app);
		if (affected.length === 0) {
			new Notice("Vault Brain: no garbled Journam*/Journpm* folders found.");
			return;
		}

		if (folderPatternStillCorrupted(this.settings.dateOrganization)) {
			new Notice(
				"Vault Brain: your current Folder pattern (Settings → Date organization) still resolves to a garbled path today — fix it first (check the live preview under the field), or repair would just move notes into another broken folder.",
				12000
			);
			return;
		}

		const confirmed = await ConfirmModal.ask(
			this.app,
			`Repair ${affected.length} note(s) in garbled date folders?`,
			`Older versions of Vault Brain's default folder pattern could get misread by moment.js and scatter notes into folders like "Journam24" or "Journpm11" instead of a real Journal/YYYY/MM-MMMM path. This moves those ${affected.length} note(s) back to their correct date folder (links stay intact) and removes the empty broken folders afterward. Continue?`,
			"Repair vault"
		);
		if (!confirmed) return;

		const notice = new Notice("Vault Brain: repairing…", 0);
		const result = await repairCorruptedDateFolders(this.app, this.settings.dateOrganization, (done, total) => {
			notice.setMessage(`Vault Brain: repairing… ${done}/${total}`);
		});
		notice.hide();

		const stillBroken = findCorruptedFiles(this.app).length;
		if (stillBroken > 0) {
			new Notice(
				`Vault Brain: moved ${result.filesMoved}/${result.filesFound} note(s), but ${stillBroken} are still in a garbled folder — the Folder pattern is likely still wrong. Check Settings → Date organization → Folder pattern's live preview.`,
				12000
			);
			return;
		}

		new Notice(`Vault Brain: moved ${result.filesMoved}/${result.filesFound} note(s), removed ${result.foldersRemoved} empty broken folder(s).`);
	}

	// ---------------------------------------------------------------- Graph auto-color

	private async autoColorGraph(groupBy: GraphGroupBy): Promise<void> {
		const groups = previewGraphGroups(this.app, groupBy, this.settings.graphColor);
		if (groups.length === 0) {
			new Notice(`Vault Brain: no ${groupBy}s with at least ${this.settings.graphColor.minGroupSize} note(s) found.`);
			return;
		}

		const label = groupBy === "folder" ? "folder" : "tag";
		const confirmed = await ConfirmModal.ask(
			this.app,
			`Auto-color graph by ${label}?`,
			`This replaces the Graph view's current color groups with ${groups.length} auto-generated group(s), one per ${label} (${groups
				.slice(0, 6)
				.map((g) => g.name)
				.join(", ")}${groups.length > 6 ? ", …" : ""}). Any color groups you've set up manually in Graph view settings will be overwritten. Open (or reopen) the Graph view afterward to see it. Continue?`,
			"Apply colors"
		);
		if (!confirmed) return;

		const count = await applyGraphColors(this.app, groupBy, this.settings.graphColor);
		new Notice(`Vault Brain: applied ${count} graph color group(s) by ${label}. Reopen the Graph view to see them.`);
	}

	// ---------------------------------------------------------------- Folder structure

	private async createFolderStructure(): Promise<void> {
		const paths = this.settings.folderStructure.paths;
		if (paths.length === 0) {
			new Notice("Vault Brain: no folders configured. Add some under Settings → Vault Brain → Folder structure.");
			return;
		}
		const result = await createFolderStructure(this.app, paths);
		new Notice(
			result.created.length > 0
				? `Vault Brain: created ${result.created.length} folder(s), ${result.alreadyExisted.length} already existed.`
				: "Vault Brain: all configured folders already exist."
		);
	}
}
