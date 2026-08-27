import { App, TFile, normalizePath } from "obsidian";

/**
 * True for notes owned by another plugin's special format (Kanban boards, Excalidraw drawings).
 * These are still plain .md files to Obsidian's API, but moving them or splicing wikilinks/a
 * Related Notes section into their body would corrupt the board/drawing that plugin renders from it.
 */
export function isSpecialPluginNote(app: App, file: TFile): boolean {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	if (!frontmatter) return false;
	return "kanban-plugin" in frontmatter || "excalidraw-plugin" in frontmatter;
}

/** Returns true if `path` sits inside (or equals) any of the given folder paths. */
export function isPathExcluded(path: string, excludeFolders: string[]): boolean {
	const normalized = normalizePath(path);
	return excludeFolders.some((folder) => {
		const f = normalizePath(folder);
		if (!f) return false;
		return normalized === f || normalized.startsWith(f + "/");
	});
}

/** Creates every missing folder along `path`, mirroring `mkdir -p`. */
export async function ensureFolderExists(app: App, path: string): Promise<void> {
	const normalized = normalizePath(path);
	if (!normalized || normalized === "/") return;
	const parts = normalized.split("/").filter(Boolean);
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		const existing = app.vault.getAbstractFileByPath(current);
		if (!existing) {
			try {
				await app.vault.createFolder(current);
			} catch (e) {
				// Folder may have been created concurrently; ignore if it now exists.
				if (!app.vault.getAbstractFileByPath(current)) throw e;
			}
		}
	}
}

/** Resolves a free, non-colliding path for a target base path (handles `file.md` -> `file 1.md`). */
export function resolveUniquePath(app: App, desiredPath: string, ignore?: TFile): string {
	const normalized = normalizePath(desiredPath);
	const existing = app.vault.getAbstractFileByPath(normalized);
	if (!existing || existing === ignore) return normalized;

	const extIndex = normalized.lastIndexOf(".");
	const base = extIndex >= 0 ? normalized.slice(0, extIndex) : normalized;
	const ext = extIndex >= 0 ? normalized.slice(extIndex) : "";

	let counter = 1;
	let candidate = `${base} ${counter}${ext}`;
	while (app.vault.getAbstractFileByPath(candidate) && app.vault.getAbstractFileByPath(candidate) !== ignore) {
		counter += 1;
		candidate = `${base} ${counter}${ext}`;
	}
	return candidate;
}

/** Strips YAML frontmatter, code fences and inline code from note content before text scanning. */
export function stripNonProseRegions(content: string): string {
	let result = content;
	result = result.replace(/^---\n[\s\S]*?\n---\n?/, "");
	result = result.replace(/```[\s\S]*?```/g, (match) => " ".repeat(match.length));
	result = result.replace(/`[^`]*`/g, (match) => " ".repeat(match.length));
	return result;
}

export function daysSince(timestampMs: number): number {
	return (Date.now() - timestampMs) / (1000 * 60 * 60 * 24);
}

export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reads every tag on a note — inline #tags and frontmatter `tags` (array or comma-separated string). */
export function getFileTags(app: App, file: TFile): Set<string> {
	const cache = app.metadataCache.getFileCache(file);
	const tags = new Set<string>();
	for (const t of cache?.tags ?? []) tags.add(t.tag.replace(/^#/, "").toLowerCase());
	const fmTags = cache?.frontmatter?.tags;
	if (Array.isArray(fmTags)) fmTags.forEach((t) => typeof t === "string" && tags.add(t.replace(/^#/, "").toLowerCase()));
	else if (typeof fmTags === "string") fmTags.split(",").forEach((t) => tags.add(t.trim().replace(/^#/, "").toLowerCase()));
	return tags;
}
