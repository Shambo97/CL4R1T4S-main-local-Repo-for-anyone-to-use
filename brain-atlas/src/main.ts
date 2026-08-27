import { Plugin } from "obsidian";
import { BrainAtlasSettings, DEFAULT_SETTINGS } from "./settings";
import { BrainAtlasSettingTab } from "./settingsTab";
import { BrainAtlasView, VIEW_TYPE_BRAIN_ATLAS } from "./brainView";

export default class BrainAtlasPlugin extends Plugin {
	settings: BrainAtlasSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new BrainAtlasSettingTab(this.app, this));

		this.registerView(VIEW_TYPE_BRAIN_ATLAS, (leaf) => new BrainAtlasView(leaf, this));
		this.addRibbonIcon("brain", "Open Brain Atlas", () => void this.activateView());

		this.addCommand({
			id: "open-brain-atlas",
			name: "Open Brain Atlas",
			callback: () => void this.activateView(),
		});
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_BRAIN_ATLAS)[0];
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_BRAIN_ATLAS, active: true });
		}
		workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<BrainAtlasSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...loaded,
			enabledRegions: { ...DEFAULT_SETTINGS.enabledRegions, ...loaded?.enabledRegions },
			folderKindMap: { ...DEFAULT_SETTINGS.folderKindMap, ...loaded?.folderKindMap },
			tagKindMap: { ...DEFAULT_SETTINGS.tagKindMap, ...loaded?.tagKindMap },
			folderRegionMap: { ...DEFAULT_SETTINGS.folderRegionMap, ...loaded?.folderRegionMap },
			tagRegionMap: { ...DEFAULT_SETTINGS.tagRegionMap, ...loaded?.tagRegionMap },
			pinnedNodePositions: { ...DEFAULT_SETTINGS.pinnedNodePositions, ...loaded?.pinnedNodePositions },
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
