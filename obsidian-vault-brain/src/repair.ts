import { App, TFile, TFolder, moment } from "obsidian";
import { DateOrganizationSettings } from "./settings";
import { organizeNote } from "./dateOrganizer";

// Matches the exact corruption this plugin's old unescaped default pattern produced: moment.js
// silently reads literal "Journal" as tokens ("a" = am/pm, "l" = localized date) whenever a folder
// pattern contains un-bracketed literal text, scattering notes into "Journam4", "Journpm11", etc.
const CORRUPTED_FOLDER_SEGMENT = /^Journ[ap]m\d{1,2}$/i;

function containsCorruptedSegment(path: string): boolean {
	return path.split("/").some((segment) => CORRUPTED_FOLDER_SEGMENT.test(segment));
}

/** Finds every note currently stranded under a garbled date-folder segment. */
export function findCorruptedFiles(app: App): TFile[] {
	return app.vault.getMarkdownFiles().filter((file) => containsCorruptedSegment(file.path));
}

/**
 * True if the *current* folder pattern would itself still produce a garbled path today — i.e. repair
 * would just move notes from one broken folder into another. Repair refuses to run while this is true.
 */
export function folderPatternStillCorrupted(settings: DateOrganizationSettings): boolean {
	let resolved: string;
	try {
		resolved = moment().format(settings.folderPattern);
	} catch {
		return true;
	}
	return containsCorruptedSegment(resolved);
}

export interface RepairResult {
	filesFound: number;
	filesMoved: number;
	foldersRemoved: number;
	moves: { fromPath: string; toPath: string }[];
	errors: { path: string; message: string }[];
}

/**
 * Moves every note stranded in a garbled Journam/Journpm-style folder back to its correct date-based
 * location (per current settings), then removes whichever of those broken folders end up empty.
 * A single file failing to move (name collision, filesystem error, etc.) is recorded and skipped
 * rather than aborting the rest of the batch.
 */
export async function repairCorruptedDateFolders(
	app: App,
	settings: DateOrganizationSettings,
	onProgress?: (done: number, total: number) => void
): Promise<RepairResult> {
	const affected = findCorruptedFiles(app);
	const corruptedRoots = new Set<string>();
	for (const file of affected) {
		const bad = file.path.split("/").find((segment) => CORRUPTED_FOLDER_SEGMENT.test(segment));
		if (bad) corruptedRoots.add(file.path.slice(0, file.path.indexOf(bad) + bad.length));
	}

	const moves: { fromPath: string; toPath: string }[] = [];
	const errors: { path: string; message: string }[] = [];
	let done = 0;
	for (const file of affected) {
		const fromPath = file.path;
		try {
			const result = await organizeNote(app, file, settings);
			if (result.moved) moves.push({ fromPath, toPath: result.toPath });
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			errors.push({ path: fromPath, message });
			console.error(`Vault Brain: failed to repair "${fromPath}":`, e);
		}
		done += 1;
		onProgress?.(done, affected.length);
	}

	let foldersRemoved = 0;
	for (const rootPath of corruptedRoots) {
		foldersRemoved += await removeIfEmptyRecursive(app, rootPath);
	}

	return { filesFound: affected.length, filesMoved: moves.length, foldersRemoved, moves, errors };
}

/** Deletes `path` (and, bottom-up, any now-empty ancestor folders it leaves behind) if it's empty. Returns count removed. */
async function removeIfEmptyRecursive(app: App, path: string): Promise<number> {
	const folder = app.vault.getAbstractFileByPath(path);
	if (!(folder instanceof TFolder)) return 0;

	let removed = 0;
	for (const child of [...folder.children]) {
		if (child instanceof TFolder) removed += await removeIfEmptyRecursive(app, child.path);
	}

	const stillEmpty = app.vault.getAbstractFileByPath(path);
	if (stillEmpty instanceof TFolder && stillEmpty.children.length === 0) {
		await app.vault.delete(stillEmpty);
		removed += 1;
	}
	return removed;
}
