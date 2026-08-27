import { App, TFile } from "obsidian";
import { AutoLinkingSettings } from "./settings";
import { escapeRegExp, isPathExcluded } from "./utils";

interface TitleEntry {
	file: TFile;
	canonicalTitle: string;
}

type ProtectedRange = [number, number];

/** Maps every candidate link text (note title + aliases, lowercased) to the note it should point at. */
export function buildTitleIndex(app: App, settings: AutoLinkingSettings): Map<string, TitleEntry> {
	const index = new Map<string, TitleEntry>();
	for (const file of app.vault.getMarkdownFiles()) {
		if (isPathExcluded(file.path, settings.excludeFolders)) continue;
		if (file.basename.length >= settings.minWordLength) {
			addTitle(index, file.basename, file, settings);
		}
		if (settings.useAliases) {
			const aliases = app.metadataCache.getFileCache(file)?.frontmatter?.aliases;
			for (const alias of normalizeAliasList(aliases)) {
				if (alias.length >= settings.minWordLength) addTitle(index, alias, file, settings);
			}
		}
	}
	return index;
}

function normalizeAliasList(raw: unknown): string[] {
	if (!raw) return [];
	if (Array.isArray(raw)) return raw.filter((a): a is string => typeof a === "string");
	if (typeof raw === "string") return [raw];
	return [];
}

function addTitle(index: Map<string, TitleEntry>, title: string, file: TFile, settings: AutoLinkingSettings): void {
	const key = settings.caseSensitive ? title : title.toLowerCase();
	// First writer wins so two notes never fight over the same alias.
	if (!index.has(key)) index.set(key, { file, canonicalTitle: title });
}

function findProtectedRanges(content: string): ProtectedRange[] {
	const patterns = [
		/^---\n[\s\S]*?\n---\n?/,
		/```[\s\S]*?```/g,
		/`[^`\n]*`/g,
		/\[\[[^\]]*\]\]/g,
		/\[[^\]]*\]\([^)]*\)/g,
	];
	const ranges: ProtectedRange[] = [];
	for (const pattern of patterns) {
		const global = pattern.global ? pattern : new RegExp(pattern.source, "g");
		let match: RegExpExecArray | null;
		while ((match = global.exec(content)) !== null) {
			ranges.push([match.index, match.index + match[0].length]);
			if (match[0].length === 0) global.lastIndex += 1;
		}
	}
	return ranges.sort((a, b) => a[0] - b[0]);
}

function isProtected(start: number, end: number, ranges: ProtectedRange[]): boolean {
	return ranges.some(([rStart, rEnd]) => start < rEnd && end > rStart);
}

export interface AutoLinkResult {
	content: string;
	linksAdded: number;
}

/**
 * Scans note content for occurrences of other notes' titles/aliases and turns them into [[wikilinks]],
 * skipping frontmatter, code, and text that is already linked.
 */
export function autoLinkContent(
	content: string,
	currentFile: TFile,
	index: Map<string, TitleEntry>,
	settings: AutoLinkingSettings
): AutoLinkResult {
	const entries = Array.from(index.values())
		.filter((entry) => entry.file.path !== currentFile.path)
		.sort((a, b) => b.canonicalTitle.length - a.canonicalTitle.length);
	if (entries.length === 0) return { content, linksAdded: 0 };

	const alternation = entries.map((e) => escapeRegExp(e.canonicalTitle)).join("|");
	const flags = settings.caseSensitive ? "g" : "gi";
	const pattern = new RegExp(`(?<![\\w/#\\-])(${alternation})(?![\\w/\\-])`, flags);

	const protectedRanges = findProtectedRanges(content);
	const linkedTitles = new Set<string>();
	const replacements: { start: number; end: number; text: string }[] = [];

	let match: RegExpExecArray | null;
	while ((match = pattern.exec(content)) !== null) {
		const start = match.index;
		const end = start + match[0].length;
		if (match[0].length === 0) {
			pattern.lastIndex += 1;
			continue;
		}
		if (isProtected(start, end, protectedRanges)) continue;

		const key = settings.caseSensitive ? match[0] : match[0].toLowerCase();
		const entry = index.get(key);
		if (!entry || entry.file.path === currentFile.path) continue;

		const dedupeKey = entry.file.path;
		if (settings.linkFirstOccurrenceOnly && linkedTitles.has(dedupeKey)) continue;
		linkedTitles.add(dedupeKey);

		const replacementText =
			match[0] === entry.canonicalTitle ? `[[${entry.canonicalTitle}]]` : `[[${entry.canonicalTitle}|${match[0]}]]`;
		replacements.push({ start, end, text: replacementText });
	}

	if (replacements.length === 0) return { content, linksAdded: 0 };

	let result = content;
	for (let i = replacements.length - 1; i >= 0; i -= 1) {
		const r = replacements[i];
		result = result.slice(0, r.start) + r.text + result.slice(r.end);
	}
	return { content: result, linksAdded: replacements.length };
}

// --- Related notes ("massive brain" graph linking) ---------------------------------------------

export interface RelatedNote {
	file: TFile;
	score: number;
	sharedTags: string[];
}

function getTags(app: App, file: TFile): Set<string> {
	const cache = app.metadataCache.getFileCache(file);
	const tags = new Set<string>();
	for (const t of cache?.tags ?? []) tags.add(t.tag.replace(/^#/, "").toLowerCase());
	const fmTags = cache?.frontmatter?.tags;
	if (Array.isArray(fmTags)) fmTags.forEach((t) => typeof t === "string" && tags.add(t.replace(/^#/, "").toLowerCase()));
	else if (typeof fmTags === "string") fmTags.split(",").forEach((t) => tags.add(t.trim().replace(/^#/, "").toLowerCase()));
	return tags;
}

function getConnectedPaths(app: App, file: TFile): Set<string> {
	const connected = new Set<string>();
	const resolved = app.metadataCache.resolvedLinks;
	for (const target of Object.keys(resolved[file.path] ?? {})) connected.add(target);
	for (const [source, targets] of Object.entries(resolved)) {
		if (source !== file.path && Object.prototype.hasOwnProperty.call(targets, file.path)) connected.add(source);
	}
	return connected;
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let intersection = 0;
	for (const item of a) if (b.has(item)) intersection += 1;
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

/** Ranks other notes by tag/graph similarity to `file`, surfacing connections that are not already linked. */
export function computeRelatedNotes(app: App, file: TFile, settings: AutoLinkingSettings): RelatedNote[] {
	const fileTags = getTags(app, file);
	const fileConnections = getConnectedPaths(app, file);
	const results: RelatedNote[] = [];

	for (const candidate of app.vault.getMarkdownFiles()) {
		if (candidate.path === file.path) continue;
		if (isPathExcluded(candidate.path, settings.excludeFolders)) continue;
		if (fileConnections.has(candidate.path)) continue; // already directly linked, nothing new to surface

		const candidateTags = getTags(app, candidate);
		const tagScore = jaccard(fileTags, candidateTags);
		const linkScore = jaccard(fileConnections, getConnectedPaths(app, candidate));

		let score: number;
		if (settings.similarityMethod === "tags") score = tagScore;
		else if (settings.similarityMethod === "links") score = linkScore;
		else score = (tagScore + linkScore) / 2;

		if (score > 0) {
			const sharedTags = Array.from(fileTags).filter((t) => candidateTags.has(t));
			results.push({ file: candidate, score, sharedTags });
		}
	}

	results.sort((a, b) => b.score - a.score);
	return results.slice(0, settings.relatedNotesCount);
}

const SECTION_START = `<!-- vault-brain:related-notes:start -->`;
const SECTION_END = `<!-- vault-brain:related-notes:end -->`;

/** Inserts or refreshes the managed "Related Notes" block, leaving the rest of the note untouched. */
export function upsertRelatedNotesSection(content: string, related: RelatedNote[], settings: AutoLinkingSettings): string {
	const lines = [
		SECTION_START,
		`## ${settings.relatedNotesHeading}`,
		...related.map((r) => `- [[${r.file.basename}]]${r.sharedTags.length ? ` — _${r.sharedTags.map((t) => `#${t}`).join(", ")}_` : ""}`),
		SECTION_END,
	];
	const block = lines.join("\n");

	const blockRegex = new RegExp(`<!-- vault-brain:related-notes:start -->[\\s\\S]*?<!-- vault-brain:related-notes:end -->`);
	if (blockRegex.test(content)) {
		return content.replace(blockRegex, block);
	}

	const trimmed = content.replace(/\s+$/, "");
	return `${trimmed}\n\n${block}\n`;
}
