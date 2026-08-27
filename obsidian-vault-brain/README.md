# Vault Brain

An [Obsidian](https://obsidian.md) plugin with four jobs:

1. **Date organization** — files notes into date-based folders (e.g. `Journal/2026/08-August/2026-08-27.md`) automatically or on demand.
2. **Auto-linking ("massive brain")** — scans notes for mentions of your other note titles/aliases and turns them into `[[wikilinks]]`, and can append an auto-updating **Related Notes** section based on shared tags and graph connections — even between notes that don't mention each other by name.
3. **Housekeeping bot** — periodically scans the vault for orphan notes, broken links, empty notes, duplicate titles, and stale notes, and writes the results to a Markdown report note.
4. **Brain view** — renders the vault as an interactive lobed brain map: each note is classified into a kind (person, project, concept, source, …) and a lobe, sized by how connected it is, and linked by your vault's real wikilinks.

All file moves use Obsidian's `fileManager.renameFile`, so every `[[wikilink]]` pointing at a moved note is updated automatically — organizing your vault never breaks your links.

## Commands

All available from the command palette (`Ctrl/Cmd+P`):

- **Organize current note by date**
- **Organize entire vault by date** (asks for confirmation first)
- **Auto-link current note**
- **Update related notes for current note**
- **Auto-link entire vault (add links + related notes)** (asks for confirmation first)
- **Run vault housekeeping scan now**
- **Open Brain view** (also available from the ribbon icon)

## Settings

### Date organization

| Setting | Description |
| --- | --- |
| Auto-organize new notes | File a note into its date folder the moment it's created |
| Date source | `Frontmatter property`, `File created time`, or a date parsed out of the file name |
| Folder pattern | [Moment.js](https://momentjs.com/docs/#/displaying/format/) tokens, e.g. `Journal/YYYY/MM-MMMM` |
| Rename file to date | Optionally also rename the note itself, e.g. to `YYYY-MM-DD` |
| Excluded folders | Comma-separated folders Vault Brain never touches |

### Auto-linking

| Setting | Description |
| --- | --- |
| Minimum word length | Skip short titles to avoid over-linking common words |
| Use aliases | Also match a note's frontmatter `aliases` |
| Link first occurrence only | Link only the first mention of each note per note |
| Add "Related Notes" section | Appends/refreshes a managed block of related notes |
| Similarity method | Rank related notes by shared tags, shared graph connections, or both |

The Related Notes block is wrapped in HTML comment markers (`<!-- vault-brain:related-notes:start/end -->`) so re-running the command refreshes it in place instead of duplicating it.

### Housekeeping bot

| Setting | Description |
| --- | --- |
| Run scan on startup | Scan once when Obsidian loads |
| Scan interval (hours) | Automatic periodic scans; `0` disables the timer (you can still run it manually) |
| Stale note threshold | Days without a modification before a note counts as stale |
| Report folder | Where `Vault Health Report YYYY-MM-DD.md` is written (overwritten if run again same day) |
| Checks | Toggle orphan notes, broken links, empty notes, duplicate titles, stale notes, untagged notes individually |

### Brain view

Open it from the command palette or the brain icon in the ribbon. It draws a simplified side-profile brain silhouette split into six lobes, and drops each note into one:

| Lobe | Holds |
| --- | --- |
| Frontal | Projects, decisions, work threads |
| Parietal | Concepts, questions, and anything uncategorized |
| Temporal | People |
| Occipital | Sources |
| Cerebellum | Tools, indexes |
| Stem | Daily notes |

A note's **kind** (and from it, its default lobe) comes from — in order — a `kind`/`type`/`category` frontmatter value, a matching tag, or its folder; a note can also set its lobe directly with a `brain_region` (or `region`/`lobe`) frontmatter property. Notes are sized by link count, and the most-connected notes are drawn as ringed "hubs." Lines are drawn for hub connections by default; toggle **Show all links** to see every link, or hover a note to see just its own.

Drag to pan, scroll to zoom, click a note to open it (configurable to open in a new tab or just show a hover preview), right-click for an open menu, and use the search box to highlight notes by name. Region chips in the toolbar let you hide a lobe entirely. It's plain Canvas 2D — no WebGL, no continuous render loop — so it stays responsive without a GPU and costs nothing at rest; the settings tab has a **Node cap** for very large vaults and an opt-in **Idle pulse** for a subtle glow on hub notes.

The folder/tag → kind/lobe rules, palette, hub threshold, and click behavior are all configurable in Settings → Vault Brain → Brain view.

## Installation

### Manual

1. Run `npm install && npm run build` inside this folder.
2. Copy `manifest.json`, `main.js`, and `styles.css` into `<your vault>/.obsidian/plugins/vault-brain/`.
3. Reload Obsidian and enable **Vault Brain** under Settings → Community plugins.

### Development

```bash
npm install
npm run dev   # watches src/ and rebuilds main.js on change
```

## Safety notes

- Bulk commands ("Organize entire vault by date" and "Auto-link entire vault") show a confirmation dialog first, since they touch many files in one pass.
- Back up your vault (or keep it under version control) before running bulk operations for the first time, and review the change on a small folder before running it vault-wide.
- The housekeeping bot only *reads* your vault and writes a single report note — it never modifies or deletes existing notes.
