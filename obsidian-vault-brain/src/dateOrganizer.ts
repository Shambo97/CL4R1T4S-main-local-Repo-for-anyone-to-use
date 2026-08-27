import { App, TFile, moment, normalizePath } from "obsidian";
import { DateOrganizationSettings } from "./settings";
import { ensureFolderExists, isPathExcluded, resolveUniquePath } from "./utils";

export interface DateResolution {
	date: moment.Moment;
	source: "frontmatter" | "created" | "filename" | "fallback";
}

/** Works out which date to file a note under, following the configured source with sensible fallbacks. */
export function resolveNoteDate(app: App, file: TFile, settings: DateOrganizationSettings): DateResolution {
	if (settings.dateSource === "frontmatter") {
		const fromFrontmatter = readFrontmatterDate(app, file, settings.frontmatterKey);
		if (fromFrontmatter) return { date: fromFrontmatter, source: "frontmatter" };
	}

	if (settings.dateSource === "filename") {
		const fromFilename = readFilenameDate(file, settings.filenameDateRegex);
		if (fromFilename) return { date: fromFilename, source: "filename" };
	}

	// "created" source, or a fallback when the preferred source had nothing usable.
	return { date: moment(file.stat.ctime), source: "created" };
}

function readFrontmatterDate(app: App, file: TFile, key: string): moment.Moment | null {
	const cache = app.metadataCache.getFileCache(file);
	const raw = cache?.frontmatter?.[key];
	if (!raw) return null;
	const parsed = moment(raw as string, [moment.ISO_8601, "YYYY-MM-DD", "YYYY-MM-DD HH:mm"], true);
	return parsed.isValid() ? parsed : null;
}

function readFilenameDate(file: TFile, pattern: string): moment.Moment | null {
	try {
		const regex = new RegExp(pattern);
		const match = file.basename.match(regex);
		if (!match) return null;
		const [, year, month, day] = match;
		if (!year || !month || !day) return null;
		const parsed = moment(`${year}-${month}-${day}`, "YYYY-MM-DD", true);
		return parsed.isValid() ? parsed : null;
	} catch {
		return null;
	}
}

/** Computes the folder + file name a note should live at according to its resolved date. */
export function computeTargetPath(
	file: TFile,
	date: moment.Moment,
	settings: DateOrganizationSettings
): string {
	const folder = date.format(settings.folderPattern);
	const fileName = settings.renameFile ? date.format(settings.fileNamePattern) : file.basename;
	return normalizePath(`${folder}/${fileName}.${file.extension}`);
}

export interface OrganizeResult {
	file: TFile;
	moved: boolean;
	fromPath: string;
	toPath: string;
	reason?: string;
}

/** Moves (and optionally renames) a single note into its date-based folder. No-ops if already in place. */
export async function organizeNote(
	app: App,
	file: TFile,
	settings: DateOrganizationSettings
): Promise<OrganizeResult> {
	if (file.extension !== "md") {
		return { file, moved: false, fromPath: file.path, toPath: file.path, reason: "not a markdown file" };
	}
	if (isPathExcluded(file.path, settings.excludeFolders)) {
		return { file, moved: false, fromPath: file.path, toPath: file.path, reason: "excluded folder" };
	}

	const { date } = resolveNoteDate(app, file, settings);
	const desiredPath = computeTargetPath(file, date, settings);

	if (normalizePath(desiredPath) === normalizePath(file.path)) {
		return { file, moved: false, fromPath: file.path, toPath: file.path, reason: "already organized" };
	}

	const targetFolder = desiredPath.substring(0, desiredPath.lastIndexOf("/"));
	await ensureFolderExists(app, targetFolder);
	const finalPath = resolveUniquePath(app, desiredPath, file);

	const fromPath = file.path;
	// fileManager.renameFile keeps every [[wikilink]] pointing at this note intact vault-wide.
	await app.fileManager.renameFile(file, finalPath);

	return { file, moved: true, fromPath, toPath: finalPath };
}

/** Organizes every eligible markdown note in the vault. Returns a per-file result list. */
export async function organizeVault(
	app: App,
	settings: DateOrganizationSettings,
	onProgress?: (done: number, total: number) => void
): Promise<OrganizeResult[]> {
	const files = app.vault.getMarkdownFiles();
	const results: OrganizeResult[] = [];
	let done = 0;
	for (const file of files) {
		results.push(await organizeNote(app, file, settings));
		done += 1;
		onProgress?.(done, files.length);
	}
	return results;
}
