import { App, normalizePath } from "obsidian";
import { ensureFolderExists } from "./utils";

export interface ScaffoldResult {
	created: string[];
	alreadyExisted: string[];
}

/** Creates every listed folder that doesn't already exist. Never moves, renames, or deletes anything. */
export async function createFolderStructure(app: App, paths: string[]): Promise<ScaffoldResult> {
	const created: string[] = [];
	const alreadyExisted: string[] = [];

	for (const raw of paths) {
		const path = normalizePath(raw.trim());
		if (!path) continue;
		const existed = !!app.vault.getAbstractFileByPath(path);
		await ensureFolderExists(app, path);
		if (existed) alreadyExisted.push(path);
		else created.push(path);
	}

	return { created, alreadyExisted };
}
