import { Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, VaultBrainSettings } from "./settings";
import { VaultBrainSettingTab } from "./settingsTab";
import { organizeNote, organizeVault } from "./dateOrganizer";
import { autoLinkContent, buildContentWordIndex, buildTitleIndex, computeRelatedNotes, upsertRelatedNotesSection } from "./autoLinker";
import { renderReportMarkdown, runHousekeepingScan, writeReport } from "./housekeeping";
import { ConfirmModal } from "./confirmModal";
import { isSpecialPluginNote } from "./utils";
import { findCorruptedFiles, repairCorruptedDateFolders } from "./repair";

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
		};
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

		new Notice(`Vault Brain: moved ${result.filesMoved}/${result.filesFound} note(s), removed ${result.foldersRemoved} empty broken folder(s).`);
	}
}
