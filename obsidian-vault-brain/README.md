# Vault Brain

An [Obsidian](https://obsidian.md) plugin with three jobs:

1. **Date organization** — files notes into date-based folders (e.g. `Journal/2026/08-August/2026-08-27.md`) automatically or on demand.
2. **Auto-linking ("massive brain")** — scans notes for mentions of your other note titles/aliases and turns them into `[[wikilinks]]`, and can append an auto-updating **Related Notes** section based on shared tags and graph connections — even between notes that don't mention each other by name.
3. **Housekeeping bot** — periodically scans the vault for orphan notes, broken links, empty notes, duplicate titles, and stale notes, and writes the results to a Markdown report note.

All file moves use Obsidian's `fileManager.renameFile`, so every `[[wikilink]]` pointing at a moved note is updated automatically — organizing your vault never breaks your links.

## Commands

All available from the command palette (`Ctrl/Cmd+P`):

- **Organize current note by date**
- **Organize entire vault by date** (asks for confirmation first)
- **Auto-link current note**
- **Update related notes for current note**
- **Auto-link entire vault (add links + related notes)** (asks for confirmation first)
- **Run vault housekeeping scan now**
- **Repair garbled date folders (Journam\*/Journpm\*)** — see [Known issue fixed in 1.0.1](#known-issue-fixed-in-101) below
- **Auto-color graph by folder** / **Auto-color graph by tag** — generates Graph view color groups automatically
- **Create recommended folder structure** — creates any missing folders from your configured list; never moves, renames, or deletes anything

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
| Similarity method | Rank related notes by shared tags, shared graph connections, shared keywords pulled from note content, or all three (default) — keywords are what let it find connections even in a vault with no tags or links yet |

The Related Notes block is wrapped in HTML comment markers (`<!-- vault-brain:related-notes:start/end -->`) so re-running the command refreshes it in place instead of duplicating it.

### Housekeeping bot

| Setting | Description |
| --- | --- |
| Run scan on startup | Scan once when Obsidian loads |
| Scan interval (hours) | Automatic periodic scans; `0` disables the timer (you can still run it manually) |
| Stale note threshold | Days without a modification before a note counts as stale |
| Report folder | Where `Vault Health Report YYYY-MM-DD.md` is written (overwritten if run again same day) |
| Checks | Toggle orphan notes, broken links, empty notes, duplicate titles, stale notes, untagged notes individually |

### Graph auto-color

`Auto-color graph by folder` and `Auto-color graph by tag` generate one Graph view color group per folder (or per tag), each an evenly-spaced hue so no two groups look alike, and write them straight into Obsidian's own Graph view config — the same `colorGroups` you'd otherwise set up by hand in Graph view's settings. Reopen (or open) the Graph view afterward to see it; Obsidian only reads this config when a graph pane opens.

| Setting | Description |
| --- | --- |
| Folder grouping depth | How many path segments deep to group by (1 = top-level folder only) |
| Maximum groups | Caps how many groups get created — Graph view colors get hard to distinguish past ~15 |
| Minimum notes per group | Skips folders/tags with too few notes to be worth a color |
| Excluded folders | Folders left out of grouping entirely |

This only targets Obsidian's built-in Graph view. It does not touch Brain Atlas's coloring — that plugin keeps its own private config (frontmatter/tag/folder → "kind"/"region" maps) that isn't part of Obsidian's documented format, so writing to it directly would risk corrupting settings Brain Atlas doesn't expect a different plugin to touch.

**This replaces any color groups you've already set up manually in Graph view — it doesn't merge with them.** The command asks for confirmation and previews which groups it's about to create before doing anything.

### Folder structure

`Create recommended folder structure` reads a list of paths (one per line) from Settings → Vault Brain → Folder structure, and creates whichever of them don't exist yet. It's purely additive: it never touches an existing folder or moves any content, so it's safe to run repeatedly as you refine the list.

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
- Vault Brain leaves **Kanban boards** (`kanban-plugin` frontmatter) and **Excalidraw drawings** (`excalidraw-plugin` frontmatter) alone entirely — it won't move them or splice wikilinks/a Related Notes section into their body, since either would corrupt what those plugins render from the file.
- If you're running other note-moving plugins (Auto Note Mover, Advanced Note Mover, etc.) alongside Vault Brain, don't point more than one of them at the same folder pattern — two movers racing to relocate the same note is a recipe for exactly the kind of corruption described below. Pick one plugin to own date-based filing and disable the date-organization side of the others.

## Known issue fixed in 1.0.1

Folder and file-name patterns are [moment.js format strings](https://momentjs.com/docs/#/displaying/format/), where **every letter is a token unless wrapped in `[brackets]`**. Versions before 1.0.1 shipped a default folder pattern of `Journal/YYYY/MM-MMMM` — but in moment.js, the `a` in "Journal" means "am/pm" and the `l` means "localized date," so the literal word "Journal" was silently reinterpreted every time a note was filed. The result: instead of one `Journal` folder, you'd get a different garbled folder per note — `Journam4`, `Journpm11`, `Journam24`, and so on, one for roughly every distinct day/time-of-day combination notes were created at.

**1.0.1 fixes this two ways:**
- The default pattern is now correctly escaped (`[Journal]/YYYY/MM-MMMM`), and the settings tab shows a **live preview** under both pattern fields so any future typo is obvious before it touches your vault.
- If you were on an earlier version and already have `Journam*`/`Journpm*` folders, run **"Repair garbled date folders"** from the command palette. It moves every note stranded in one of those folders back to its correct `Journal/YYYY/MM-MMMM` location (links stay intact — it uses the same move as everything else), then deletes the now-empty broken folders. It only touches folders matching that exact corruption pattern, and asks for confirmation first.

**1.2.1 fixes a follow-on bug:** if you'd already installed the plugin before 1.0.1, your saved settings (`data.json`) had the broken pattern written into them directly — and saved settings take precedence over the code's default, so upgrading the plugin alone didn't actually fix your *running* pattern. Repair would then either recreate a garbled folder or decide the file was "already organized" and silently do nothing. 1.2.1 migrates that saved value automatically on load, and the repair command now refuses to run (with an explanation) if your current pattern would still produce a garbled path, and double-checks after running that nothing is still stranded.

**1.2.2 fixes a third bug:** the repair loop had no error handling — if any single file failed to move (a name collision, for instance), the whole batch silently stopped right there, leaving most of the garbled folders untouched with no error message. Repair now catches per-file failures, keeps going through the rest of the batch, and reports exactly how many failed (with details in the developer console). It also now checks on every launch for leftover garbled folders and shows a clickable notice to repair them, so fixing the pattern doesn't quietly leave old damage behind.
