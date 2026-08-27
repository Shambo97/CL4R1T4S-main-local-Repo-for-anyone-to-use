# Brain Atlas

An [Obsidian](https://obsidian.md) plugin that renders your vault as an interactive **lobed brain map**. Every note is classified into a *kind* (person, project, concept, source, …) and a brain *lobe*, sized by how connected it is, and linked by your vault's real wikilinks.

This is a ground-up rewrite, built as plain Canvas 2D instead of WebGL:

- **No GPU dependency, no continuous render loop.** Panning, zooming, hovering and clicking all run off ordinary pointer events; the canvas only redraws when something actually changes. It stays responsive on modest hardware and costs nothing at rest.
- **The graph is always accurate.** Edges come straight from Obsidian's own resolved-link index — there's no separately maintained shadow graph that can drift out of sync with your vault.
- **Drag-to-pin.** Drag any note to a spot you like and it stays there — across sessions, independent of its assigned lobe — instead of only ever landing wherever an algorithm puts it. Right-click a pinned note to unpin it, or clear all pinned positions from Settings.
- **Readable source.** The whole plugin is under 1,000 lines of typed TypeScript across five small files, not a single minified bundle.

## Usage

Open it from the command palette (**Open Brain Atlas**) or the brain icon in the ribbon. It draws a simplified side-profile brain silhouette split into six lobes:

| Lobe | Holds |
| --- | --- |
| Frontal | Projects, decisions, work threads |
| Parietal | Concepts, questions, and anything uncategorized |
| Temporal | People |
| Occipital | Sources |
| Cerebellum | Tools, indexes |
| Stem | Daily notes |

A note's **kind** — and from it, its default lobe — comes from, in order: a `kind`/`type`/`category` frontmatter value, a matching tag, or its folder. A note can also set its lobe directly with a `brain_region` (or `region`/`lobe`) frontmatter property. All of these rules are editable in Settings → Brain Atlas.

- **Pan** by dragging empty space, **zoom** with the scroll wheel.
- **Drag a note** to reposition and pin it (a dashed ring marks a pinned note); right-click it for an "Unpin position" option.
- **Click a note** to open it (configurable to open in a new tab or just show a hover preview instead).
- **Search** the toolbar box to highlight notes by name.
- **Region chips** in the toolbar hide/show a lobe entirely.
- Notes are sized by link count; the most-connected notes are drawn as ringed "hubs," and lines are drawn for hub connections by default — toggle **Show all links** to see every link, or just hover a note to see its own.

## Settings

| Setting | Description |
| --- | --- |
| Palette | Match Obsidian's theme, a saturated "bio" look, or monochrome |
| Click action | Open in current pane, open in new tab, or hover preview |
| Hub threshold (%) | How connected a note must be (relative to the vault's most-linked note) to count as a hub |
| Node cap | Maximum notes rendered — lower this on very large vaults for smoother panning |
| Only label hub notes | Off shows every note's label once zoomed in close enough |
| Idle pulse | Optional subtle glow animation on hub notes (off by default, to stay CPU/battery-cheap) |
| Pinned notes | Shows how many notes are pinned; button to clear all pins |
| Folder/Tag → kind, Folder/Tag → lobe | Classification rules, one `key: value` per line |

## Installation

### Manual

1. Run `npm install && npm run build` inside this folder.
2. Copy `manifest.json`, `main.js`, and `styles.css` into `<your vault>/.obsidian/plugins/brain-atlas/`.
3. Reload Obsidian and enable **Brain Atlas** under Settings → Community plugins.

### Development

```bash
npm install
npm run dev   # watches src/ and rebuilds main.js on change
```

## Safety notes

Brain Atlas only *reads* your vault — it classifies and displays notes but never modifies, moves, or deletes anything. The one thing it writes is its own settings file (pinned positions and your classification rules), not your notes.
