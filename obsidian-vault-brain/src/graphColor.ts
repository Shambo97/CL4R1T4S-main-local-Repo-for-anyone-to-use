import { App, normalizePath } from "obsidian";
import { GraphColorSettings } from "./settings";
import { getFileTags, isPathExcluded, isSpecialPluginNote } from "./utils";

export type GraphGroupBy = "folder" | "tag";

interface GraphColor {
	a: number;
	rgb: number;
}

interface GraphColorGroup {
	query: string;
	color: GraphColor;
}

/** Obsidian's own Graph view config file — https://help.obsidian.md/plugins/graph, colorGroups format is undocumented but stable. */
interface GraphConfig {
	colorGroups?: GraphColorGroup[];
	[key: string]: unknown;
}

function hslToRgbInt(h: number, s: number, l: number): number {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	const R = Math.round((r + m) * 255);
	const G = Math.round((g + m) * 255);
	const B = Math.round((b + m) * 255);
	return (R << 16) + (G << 8) + B;
}

/** Evenly spaced, visually distinct hues around the color wheel — group 0 and group N never look alike. */
function generatePalette(count: number): number[] {
	const colors: number[] = [];
	for (let i = 0; i < count; i += 1) {
		const hue = (i * (360 / Math.max(count, 1))) % 360;
		colors.push(hslToRgbInt(hue, 0.62, 0.56));
	}
	return colors;
}

function topLevelFolder(path: string, depth: number): string | null {
	const parts = path.split("/");
	if (parts.length <= 1) return null; // file sits at vault root, no folder to group by
	return parts.slice(0, Math.min(depth, parts.length - 1)).join("/");
}

export interface GraphGroupPreview {
	name: string;
	noteCount: number;
}

/** Counts eligible notes per group (folder path or tag) without touching any config yet — used for the confirmation dialog. */
export function previewGraphGroups(app: App, groupBy: GraphGroupBy, settings: GraphColorSettings): GraphGroupPreview[] {
	const counts = new Map<string, number>();
	for (const file of app.vault.getMarkdownFiles()) {
		if (isPathExcluded(file.path, settings.excludeFolders) || isSpecialPluginNote(app, file)) continue;

		if (groupBy === "folder") {
			const folder = topLevelFolder(file.path, settings.folderDepth);
			if (folder) counts.set(folder, (counts.get(folder) ?? 0) + 1);
		} else {
			for (const tag of getFileTags(app, file)) {
				counts.set(tag, (counts.get(tag) ?? 0) + 1);
			}
		}
	}

	return Array.from(counts.entries())
		.filter(([, count]) => count >= settings.minGroupSize)
		.sort((a, b) => b[1] - a[1])
		.slice(0, settings.maxGroups)
		.map(([name, noteCount]) => ({ name, noteCount }));
}

function buildColorGroups(groups: GraphGroupPreview[], groupBy: GraphGroupBy): GraphColorGroup[] {
	const palette = generatePalette(groups.length);
	return groups.map((group, i) => ({
		query: groupBy === "folder" ? `path:"${group.name}"` : `tag:#${group.name}`,
		color: { a: 1, rgb: palette[i] },
	}));
}

/** Overwrites the Graph view's color groups with one auto-generated group per folder or tag. Existing groups are replaced. */
export async function applyGraphColors(app: App, groupBy: GraphGroupBy, settings: GraphColorSettings): Promise<number> {
	const groups = previewGraphGroups(app, groupBy, settings);
	const colorGroups = buildColorGroups(groups, groupBy);

	const configPath = normalizePath(`${app.vault.configDir}/graph.json`);
	let config: GraphConfig = {};
	if (await app.vault.adapter.exists(configPath)) {
		try {
			config = JSON.parse(await app.vault.adapter.read(configPath));
		} catch {
			config = {};
		}
	}
	config.colorGroups = colorGroups;
	await app.vault.adapter.write(configPath, JSON.stringify(config, null, 2));

	return groups.length;
}
