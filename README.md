# plugins

Figma plugins, one folder each. Personal and Remsoft tooling, mostly small and built for a specific job.

## What is here

| Folder | What it does |
| --- | --- |
| [`htmlizer`](./htmlizer) | Paste HTML, get real Figma auto layout frames and text nodes. Built so Claude can hand over a design as HTML and have it arrive editable, with lists as single text nodes using native bullet formatting. |

## How this repo works

**Every folder is self contained.** No shared code, no build step, no package manager. Each plugin holds its own `manifest.json`, `code.js` and `ui.html`, and Figma imports it directly from that manifest.

This is deliberate. A Figma plugin manifest points at one file for the UI and one for the sandbox, and neither can import from outside itself, so sharing code between plugins means either a bundler or hand copied files. Neither is worth it until two plugins genuinely need the same logic. If that day comes, decide then.

So the only thing the monorepo buys is one clone, one place to look, and this index. That is enough.

## Installing any of them

Figma **desktop app** only, since local plugin import needs filesystem access.

1. Clone or download this repo to a real folder on disk.
2. In Figma, press Cmd K and type "import plugin from manifest". Or use the Figma menu, Plugins, Development, Import plugin from manifest.
3. Pick the `manifest.json` inside the plugin folder you want.

It then appears under Plugins, Development. Re-import after changing a manifest; code changes are picked up on the next run.

## Working on these

Each plugin folder has its own `README.md` with its spec, design decisions and known limits. Read that one before changing anything, since several of the decisions were reached by trying the obvious thing first and finding out why it does not work.