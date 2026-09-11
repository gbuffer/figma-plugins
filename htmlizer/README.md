# HTMLizer

A local Figma development plugin. Paste HTML into it, get real Figma auto layout frames and text nodes on the canvas.

Built for Grant Hull (Remsoft) with Claude, September 2026. Lives in the `figma-plugins` monorepo, self contained, no build step.

## The one rule that matters

**Adapt the plugin to the HTML, never the HTML to the plugin.**

The plugin is the shared artefact. The HTML is whatever any Claude, any teammate, or any web page happens to produce. If a colleague is handed this plugin and asks their own Claude for a diagram, that Claude knows nothing about this converter and should not have to.

So when something renders wrong, the fix goes in `ui.html` or `code.js`. Rewriting the source HTML to dodge a converter limitation is the wrong direction and was explicitly rejected during the build. If a session starts "let me adjust the HTML so the plugin handles it", that is the mistake.

**Any CSS this converter mishandles is a converter bug, not a document bug.** The reason is not purity. A document rewritten to suit the converter fixes exactly one document, while the next one hits the same limitation and its author has no way of knowing the rules. Tuning the HTML also hides the defect, so it is still there when someone else meets it. During the build, three rounds of fixes went into the converter and the source HTML was reverted to its original unmodified form, which then converted correctly. That is the evidence the rule works.

The only exception is a genuine CSS feature the converter cannot express in Figma at all, and those are listed under Known limits below. Even then, prefer adding converter support first.

## Why this exists rather than an off the shelf tool

`html.to.design` by divRIOTS already does general HTML to Figma conversion, and it is better than this for arbitrary web pages. Two things it will not do:

1. A `<ul>` arriving as **one** text node with Figma's native list formatting applied across the range, hanging indent intact. It splits lists into a node per item. Grant specifically wants one editable text block with the bullet as text formatting, not a separate shape or node per bullet.
2. Mapping class names to Remsoft text styles and colour variables, so output lands bound to the design system rather than carrying raw hex. Not built yet, but the reason this converter is worth owning.

Do not rebuild general HTML conversion. Own the narrow part.

## How to install

Figma **desktop app** only. Local plugin import needs filesystem access, so the browser cannot do it.

Cmd K, type "import plugin from manifest", pick `manifest.json`. Or Figma menu, Plugins, Development, Import plugin from manifest.

All three files must sit in one real folder on disk. Figma reads `code.js` and `ui.html` by relative path from the manifest.

Appears as **HTMLizer** under Plugins, Development.

Re-import after changing `name` or `id` in the manifest, since Figma reads both at import time. Code changes in `ui.html` and `code.js` are picked up on the next run with no re-import.

## Architecture

Two halves, as every Figma plugin has.

`ui.html` runs in a real browser iframe, so it has a real DOM. It renders the pasted HTML into a hidden div at its natural width, walks it, and reads `getComputedStyle` on every element. This borrows Chrome's layout engine instead of writing one. It emits a plain JSON tree.

`code.js` runs in the Figma sandbox with no DOM. It receives the tree and builds frames and text nodes.

`manifest.json` is a four line pointer: `name` is the display label, `id` only has to be unique among locally imported plugins, and `main` and `ui` name the two files above. Currently name `HTMLizer`, id `htmlizer`. Nothing about the conversion depends on it.

Transport is paste into a textarea. MCP transport was considered and deferred. If it comes back, `html.to.design` already exposes an `import-html` MCP tool at `https://mcp.to.design`, which is cheaper than building one.

## Mapping

| CSS | Figma |
| --- | --- |
| `display: flex; flex-direction: row` | horizontal auto layout |
| anything else with children | vertical auto layout |
| `gap` / `row-gap` / `column-gap` | item spacing |
| `padding` | padding |
| `flex-grow > 0` | `layoutSizingHorizontal = FILL` |
| `flex-basis` in px with grow | FILL plus `minWidth` |
| `flex-basis` in px without grow | FIXED width |
| child of a horizontal row | `layoutSizingVertical = FILL`, so rows are even |
| child of a vertical column | `layoutSizingHorizontal = FILL` |
| `max-width` in px | `maxWidth` |
| `background-color` | fill |
| `border` | stroke, with per side weights |
| `border-radius` | corner radius |
| `overflow: hidden` | clips content |
| `<ul>` / `<ol>` | ONE text node, `setRangeListOptions` plus `setRangeIndentation` |
| `li` bottom margin | paragraph spacing and list spacing |
| `column-count: n` on a list | n text nodes in a horizontal frame |
| `min-width` / `max-width` in px | `minWidth` / `maxWidth` |
| `margin: 0 auto` on a child | parent's cross axis alignment set to CENTER |
| empty div with a fill and height under 8px | divider frame |

### Input shapes

Accepts either a bare fragment such as `<div class="wrap">…</div>` with its `<style>` block, or a **complete HTML document** with `<!DOCTYPE>`, `<html>`, `<head>` and `<body>`.

The full document case needs real work, because assigning to `innerHTML` makes the browser discard the `html`, `head` and `body` tags and hoist their contents. That leaves `<meta>` and `<title>` sitting as siblings of the content, and loses whatever `body` itself was styled with. Padding and background on `body` is a common pattern, so losing it matters.

So a document is parsed with `DOMParser`, its `<style>` blocks are copied across, and a div stands in for `body`. Rules written against the `body` or `html` selector are rewritten to target that div. The stand in then becomes the outer frame.

The root element is chosen as the first child that actually renders, skipping `style`, `script`, `meta`, `title`, `link`, `base`, `head`, `noscript` and anything with `display: none`. If several things render, they are wrapped together rather than the first one being picked.

**The original bug here is instructive.** The root picker took the first child that was not a `<style>`, which on a full document is the `<meta>`. Since `meta` is `display: none`, the walker returned nothing and the plugin reported "That produced nothing convertible", which said nothing useful about the cause. Error messages now name what was actually found.

### Sizing

Use `layoutSizingHorizontal` and `layoutSizingVertical` with FIXED, HUG and FILL. Do **not** go back to `layoutAlign`, `layoutGrow` and `counterAxisSizingMode`; they conflict with each other and produced the first round of bugs. The old properties survive only as a fallback in a catch block.

**Sizing must be applied after the node is appended to its auto layout parent.** FILL cannot resolve against a parent that does not exist yet. This is the single easiest thing to break.

### Margins

Frames have no margin in Figma. Resolved in four ways, cheapest first:

1. **Into the parent's padding.** A margin on the first or last child, or a horizontal margin shared by every child, is visually identical to the parent's padding.
2. **Into the child's own padding.** If the child has no fill, border or radius, nothing is visible in that strip, so the margin becomes the child's padding. Zero extra nodes.
3. **A transparent wrapper frame.** Only when the child *is* decorated, where folding would stretch its background into the margin. Named `<child> inset`.
4. **Gap plus spacer frames.** Between siblings. Block layout collapses adjacent vertical margins and flex does not, so take the max in block flow and the sum in flex.

Auto margins are read through `computedStyleMap`, not `getComputedStyle`. The latter returns a resolved pixel value and the intent is lost.

### margin-top: auto

Reproduced by grouping, not by a spacer. Everything above the auto margin goes into a frame named `content`, the parent flips to `SPACE_BETWEEN` with exactly two children, and `content` carries the original gap as bottom padding so a short card still spaces correctly.

**Do not use a fill height spacer for this.** It was tried and it broke everything. A frame set to fill height inside a parent that hugs its content is circular: the spacer wants the leftover space, the parent wants to be as tall as its children including the spacer. Figma breaks the loop by fixing heights at build time, after which nothing resizes and every band comes out far too tall.

Absolute positioning with a bottom constraint also pins it, but takes the node out of the flow so the card stops hugging it. Rejected.

## Known limits

Real Figma constraints, not laziness:

- **Strokes are one colour for all four sides.** Per side widths are fine. Different colours per side warns and the widest side wins. Related finding: a single stroke with a thicker left edge tapers nicely into the rounded corners, which a separate stripe child cannot do. Grant likes this, so uniform colour with varied widths is the preferred house style.
- **Text nodes cannot hold padding, fill or strokes.** Anything needing them gets a wrapper frame, named `<text> box`.
- **Baseline alignment is unavailable** when children fill vertically, which they do in every row here. Not a loss for card layouts.
- Not supported: grid, absolute positioning, transforms, shadows, gradients, images, pseudo elements, mixed inline formatting. `flex-wrap` is deliberately ignored, because `layoutWrap = WRAP` stops children from filling.
- Font weights are snapped to real weights. 650 becomes Semi Bold.
- Fonts missing from Figma fall back to Inter and are reported.

## Testing a change

**Nobody in a chat session can run this.** Figma is a desktop app on Grant's machine and the converter only does anything once real HTML goes through it in a real Figma file. A change you reason about is a hypothesis, not a fix.

So the loop is: hand over the edited file, say what you changed and what should now happen, and wait. Grant drops the file into the local repo folder, runs the plugin, and reports back. Do not say a change works, or that something is fixed, before seeing evidence.

What to ask for, cheapest first:

The **plugin's log line**, which reports frames, text nodes and spacers built, font fallbacks, and every dialect violation it hit. Often enough on its own.

A **screenshot of the result**. Annotated is better, and Grant tends to annotate in red, which is more precise than either of the other two options.

The **Figma layer properties panel** in dev mode for one misbehaving element, copied or screenshotted. This is the right tool when the question is what a single node resolved to.

A **Figma MCP link** to the frame. Much higher token cost, worth it only when the question is structural, such as which frames Figma silently made fixed rather than hugging. Prefer a screenshot otherwise.

Change one thing at a time. Three of the fixes during the build looked correct in reasoning and were wrong in Figma, and they were only separable because they were tested separately.

## Cost note

Generating HTML and converting locally is roughly five to ten times cheaper in tokens than building the same layout node by node through the Figma MCP, because the MCP loads about forty tool schemas, every node is a verbose structured call, and verifying the result needs screenshots. Figma MCP earns its cost reading an existing design or making a surgical change in a large file, not generating something new.

## Ideas not yet built

- Remsoft mode: map class names to real text styles and colour variables instead of raw hex.
- Component instances instead of plain frames for repeated cards.
- MCP transport, if pasting ever becomes the annoying part.