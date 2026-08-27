import { App, TFile, moment, normalizePath } from "obsidian";
import { HousekeepingSettings } from "./settings";
import { daysSince, ensureFolderExists, isPathExcluded, stripNonProseRegions } from "./utils";

export interface HousekeepingReport {
	generatedAt: number;
	notesScanned: number;
	orphans: TFile[];
	brokenLinks: { source: TFile; target: string }[];
	emptyNotes: TFile[];
	duplicateTitles: TFile[][];
	staleNotes: { file: TFile; daysStale: number }[];
	untaggedNotes: TFile[];
}

function eligibleFiles(app: App, settings: HousekeepingSettings): TFile[] {
	return app.vault.getMarkdownFiles().filter((f) => !isPathExcluded(f.path, settings.excludeFolders));
}

function hasTags(app: App, file: TFile): boolean {
	const cache = app.metadataCache.getFileCache(file);
	if (cache?.tags && cache.tags.length > 0) return true;
	const fmTags = cache?.frontmatter?.tags;
	if (Array.isArray(fmTags)) return fmTags.length > 0;
	if (typeof fmTags === "string") return fmTags.trim().length > 0;
	return false;
}

/** Runs every enabled housekeeping check across the vault and returns a structured report. */
export async function runHousekeepingScan(app: App, settings: HousekeepingSettings): Promise<HousekeepingReport> {
	const files = eligibleFiles(app, settings);
	const excluded = settings.excludeFolders;
	const resolved = app.metadataCache.resolvedLinks;
	const unresolved = app.metadataCache.unresolvedLinks;

	const report: HousekeepingReport = {
		generatedAt: Date.now(),
		notesScanned: files.length,
		orphans: [],
		brokenLinks: [],
		emptyNotes: [],
		duplicateTitles: [],
		staleNotes: [],
		untaggedNotes: [],
	};

	if (settings.checks.orphans) {
		for (const file of files) {
			const outCount = Object.keys(resolved[file.path] ?? {}).length + Object.keys(unresolved[file.path] ?? {}).length;
			const hasBacklink = Object.entries(resolved).some(
				([source, targets]) => source !== file.path && !isPathExcluded(source, excluded) && Object.prototype.hasOwnProperty.call(targets, file.path)
			);
			if (outCount === 0 && !hasBacklink) report.orphans.push(file);
		}
	}

	if (settings.checks.brokenLinks) {
		for (const [sourcePath, targets] of Object.entries(unresolved)) {
			if (isPathExcluded(sourcePath, excluded)) continue;
			const source = app.vault.getAbstractFileByPath(sourcePath);
			if (!(source instanceof TFile)) continue;
			for (const target of Object.keys(targets)) {
				report.brokenLinks.push({ source, target });
			}
		}
	}

	if (settings.checks.emptyNotes) {
		for (const file of files) {
			const content = await app.vault.cachedRead(file);
			const prose = stripNonProseRegions(content).trim();
			if (prose.length <= settings.emptyNoteMaxChars) report.emptyNotes.push(file);
		}
	}

	if (settings.checks.duplicateTitles) {
		const byTitle = new Map<string, TFile[]>();
		for (const file of files) {
			const key = file.basename.toLowerCase();
			const group = byTitle.get(key) ?? [];
			group.push(file);
			byTitle.set(key, group);
		}
		report.duplicateTitles = Array.from(byTitle.values()).filter((group) => group.length > 1);
	}

	if (settings.checks.staleNotes) {
		for (const file of files) {
			const daysStale = daysSince(file.stat.mtime);
			if (daysStale > settings.staleDaysThreshold) report.staleNotes.push({ file, daysStale: Math.floor(daysStale) });
		}
		report.staleNotes.sort((a, b) => b.daysStale - a.daysStale);
	}

	if (settings.checks.untaggedNotes) {
		for (const file of files) {
			if (!hasTags(app, file)) report.untaggedNotes.push(file);
		}
	}

	return report;
}

function linkList(files: TFile[], limit = 200): string {
	if (files.length === 0) return "_None found._\n";
	const shown = files.slice(0, limit);
	const lines = shown.map((f) => `- [[${f.basename}]] (\`${f.path}\`)`);
	if (files.length > limit) lines.push(`- _...and ${files.length - limit} more_`);
	return lines.join("\n") + "\n";
}

/** Renders a report into a printable Markdown note. */
export function renderReportMarkdown(report: HousekeepingReport, settings: HousekeepingSettings): string {
	const generated = moment(report.generatedAt).format("YYYY-MM-DD HH:mm");
	const totalIssues =
		report.orphans.length +
		report.brokenLinks.length +
		report.emptyNotes.length +
		report.duplicateTitles.length +
		report.staleNotes.length +
		report.untaggedNotes.length;

	const parts: string[] = [];
	parts.push(`# Vault Health Report`);
	parts.push(`Generated ${generated} · ${report.notesScanned} notes scanned · ${totalIssues} issue(s) flagged\n`);

	if (settings.checks.orphans) {
		parts.push(`## Orphan notes (${report.orphans.length})`);
		parts.push(`Notes with no incoming or outgoing links.\n`);
		parts.push(linkList(report.orphans));
	}

	if (settings.checks.brokenLinks) {
		parts.push(`## Broken links (${report.brokenLinks.length})`);
		parts.push(`Links that point at a note which doesn't exist yet.\n`);
		if (report.brokenLinks.length === 0) {
			parts.push(`_None found._\n`);
		} else {
			const lines = report.brokenLinks
				.slice(0, 200)
				.map((b) => `- [[${b.source.basename}]] → \`${b.target}\``);
			if (report.brokenLinks.length > 200) lines.push(`- _...and ${report.brokenLinks.length - 200} more_`);
			parts.push(lines.join("\n") + "\n");
		}
	}

	if (settings.checks.emptyNotes) {
		parts.push(`## Empty notes (${report.emptyNotes.length})`);
		parts.push(`Notes with little to no content.\n`);
		parts.push(linkList(report.emptyNotes));
	}

	if (settings.checks.duplicateTitles) {
		parts.push(`## Duplicate titles (${report.duplicateTitles.length} group(s))`);
		parts.push(`Different notes sharing the same file name, which can silently break [[wikilinks]].\n`);
		if (report.duplicateTitles.length === 0) {
			parts.push(`_None found._\n`);
		} else {
			for (const group of report.duplicateTitles) {
				parts.push(`- **${group[0].basename}**: ${group.map((f) => `\`${f.path}\``).join(", ")}`);
			}
			parts.push("");
		}
	}

	if (settings.checks.staleNotes) {
		parts.push(`## Stale notes (${report.staleNotes.length})`);
		parts.push(`Not modified in over ${settings.staleDaysThreshold} days.\n`);
		if (report.staleNotes.length === 0) {
			parts.push(`_None found._\n`);
		} else {
			const lines = report.staleNotes
				.slice(0, 200)
				.map((s) => `- [[${s.file.basename}]] — ${s.daysStale} days`);
			if (report.staleNotes.length > 200) lines.push(`- _...and ${report.staleNotes.length - 200} more_`);
			parts.push(lines.join("\n") + "\n");
		}
	}

	if (settings.checks.untaggedNotes) {
		parts.push(`## Untagged notes (${report.untaggedNotes.length})`);
		parts.push(`Notes with no tags, making them harder to surface.\n`);
		parts.push(linkList(report.untaggedNotes));
	}

	return parts.join("\n");
}

/** Writes (or overwrites today's) report note into the configured housekeeping folder. */
export async function writeReport(app: App, settings: HousekeepingSettings, markdown: string): Promise<TFile> {
	await ensureFolderExists(app, settings.reportFolder);
	const dateStamp = moment().format("YYYY-MM-DD");
	const path = normalizePath(`${settings.reportFolder}/Vault Health Report ${dateStamp}.md`);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, markdown);
		return existing;
	}
	return app.vault.create(path, markdown);
}
