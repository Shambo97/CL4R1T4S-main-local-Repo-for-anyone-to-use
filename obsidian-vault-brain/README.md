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
