# HTMLizer

A local Figma development plugin. Paste HTML into it, get real Figma auto layout frames and text nodes on the canvas.

Built for Grant Hull (Remsoft) with Claude, September 2026. Lives in the `figma-plugins` monorepo, self contained, no build step.

## Version

**Current: v1.** Figma validates `manifest.json` strictly and rejects any field it does not recognise, so the version cannot live there as its own field; it lives in the `name` string instead, `"HTMLizer v1"`, and in the plugin's own UI, shown under the heading every time it opens.

Version tracking starts here, at this line being added, not as a claim about how many changes came before it. Bump the number in `manifest.json` and in `ui.html`'s version line on any change that affects what the converter actually does, and add one line below. A wording fix in this document, or a comment-only change, does not need a bump.

- **v1** — version tracking begins. Equal-height-cards retracted; FILL height removed from horizontal-row children entirely. A leading or trailing spacer in a horizontal row is dropped and replaced with native row alignment, since a "fixed" px width in the source CSS is not actually fixed once a flexible sibling can shrink it.
- **v2** — v1's spacer fix gave the remaining content HUG width once its spacer sibling was dropped, which deadlocked against that content's own FILL children one level down: a HUG parent with FILL children, the same failure already covered above, just moved. Fixed by giving the remaining content a real, measured FIXED width instead.
- **v3** — `align-items: stretch` implemented, using the same FIXED-parent-plus-FILL-children pattern that fixed v2, applied deliberately this time rather than by accident: the row is measured and pinned, real content frames FILL against it, and a bare line of text with no background of its own is centred natively instead of asked to FILL, since that combination was never tested on a text node.

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
| child of a horizontal row | `layoutSizingVertical = HUG`, unless the row stretches; see "align-items: stretch" |
| `align-items: stretch`, or unset, on a horizontal row with 2+ children | row measured and pinned `FIXED`; real content frames set to FILL against it |
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
| plain `width` / `height` in px, on any element | `fixedWidth` / `fixedHeight`, taking priority over the flex defaults below |
| `data-name`, `id`, `class`, or the element's own text, in that order | Figma layer name, first one found; see Layer names below |
| `margin: 0 auto` on a child | parent's cross axis alignment set to CENTER |
| a leading or trailing spacer in a horizontal row | dropped; the row's own alignment pushes the real content instead |
| empty div with a fill, a border, or its own explicit width or height | kept as a spacer or rule frame rather than dropped |
| empty div with none of the above | dropped as noise |

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

### Plain width and height, not just flex-basis and flex-grow

Early testing only used documents with `class` and a `<style>` block, where sizing came from `flex-grow` and `flex-basis`. A document with inline styles is just as valid and often uses plain `width: 150px` on a flex item instead, which the converter used to ignore entirely, since `flex-basis` defaults to `auto` and nothing else was checked. `width` and `height` are now read directly, the same way margins are, via `computedStyleMap` so the authored value survives rather than whatever the flex layout resolved it to. This takes priority over `flex-grow` and `flex-basis` when both are absent, and applies to any element, not only flex children.

### The percentage height trap

A document built the classic hand drawn connector line: a fixed height wrapper (`height: 28px`) holding a 1px wide child with `height: 100%`. That child's percentage height has no fixed px value to carry across, and it landed as a Figma FILL by the old default rule for horizontal-row children. Its parent, however, had no explicit height mapping at the time and was going to hug. FILL inside a parent that hugs is the identical circular problem the section above describes, just reached by a different route, and it produced the same symptom: a runaway, far too tall result.

The fix has two parts. Any element with an authored `width` or `height` in px, anywhere, gets that as a fixed size rather than being left to the generic flex-direction default, which is what stops the 28px wrapper from hugging in the first place. And any element whose height is authored as something other than `auto`, including a percentage the converter cannot express as px, is measured directly in the sandbox and pinned to that real rendered number rather than trusted to resolve itself as FILL. The measurement happens before anything is sent to Figma, so it reflects the browser's own accurate layout of the pasted HTML, not a guess.

**The lesson generalised:** never let something end up as FILL on an axis without also being sure what it is filling into is not itself HUG on that same axis. This is what eventually led to removing FILL height from horizontal-row children altogether, below.

### The stretch trap

A third route to the same failure, and this one had no authored height at all to catch. A transparent spacer div used purely to hold a gap open, `<div style="width: 690px;"></div>`, sat beside a real column of content inside a horizontal flex row. Neither element set a height. The browser's own default, `align-items: stretch`, gave the empty spacer a real measured height anyway, matching whatever the row resolved to in the sandbox, and the converter's rule at the time for horizontal-row children, FILL, took that measurement at face value. The spacer then competed with its content-bearing sibling for a height that only the sibling actually had a reason to want, and the whole row came out as a tall, narrow sliver instead of hugging the sibling's natural height.

The distinguishing signal is that this spacer's height was never authored at all, not even as a percentage, unlike the connector line above. A transparent leaf with no fill, no border, and no non-auto height of any kind is now given `HUG` rather than `FILL`, and flagged internally (`isSpacer`) for the section below. An empty frame set to hug resolves to zero, contributes nothing to its parent's own height, and leaves a real sibling free to drive it, the way the browser did without anyone asking it to.

### Equal height cards, retracted

An earlier version of this document said the equal-height-cards pattern, a HUG row containing FILL cards, was "proven safe" one level above real content, and only broke a second level down, in a row whose own child was itself another horizontal row. That fix shipped, made the immediate case work, and was wrong about the general claim. Direct testing in Figma, done by hand, showed FILL height failing for an ordinary single-level case too: two columns side by side, both vertical stacks with no further horizontal nesting at all, one visibly taller than the other. Setting the taller one to HUG by hand fixed it instantly; FILL had simply never resolved to its real content height, and nothing had caught that before because row1's four cards and the fix-row's two cards all happen to have similar, short content, so a silently wrong FILL and a correctly resolved HUG would have looked the same either way. The earlier fix treated a symptom (two horizontal rows stacked) rather than the actual disease (FILL height is not reliable for a horizontal row's children at all, whether the failure is visible or not).

**FILL height is no longer used for a horizontal row's children, at any depth.** A card in a row now hugs its own real content, the same as it always did in a vertical stack. Rows that happened to look equal height because their content happened to be similar length still look that way; rows that would have quietly broken now show their true, individual heights instead. If a genuine need for matched heights comes up later, it should be solved deliberately, the way it was found: by hand, in Figma, once, rather than assumed as a converter default.

### Fixed width spacers are not actually fixed

The same document exposed a second, unrelated problem with that 690px spacer. In the browser, an element with an explicit width but no `flex-shrink: 0` is not actually fixed: if its flexible sibling (here, a wrapper with `flex: 1`) needs room and the row is narrower than everyone's preferred size combined, the browser shrinks the "fixed" width down to make room. Comparing the same page at two different widths in Safari's inspector showed the same 690px spacer rendering at two different measured widths, neither of them 690. Copying the literal CSS number into a Figma frame with a genuinely fixed width, which is what the converter did before this, reproduces what the CSS says rather than what the browser actually did with it, and the two are not the same thing.

The fix drops the spacer as a node entirely, for the specific shape most spacers like this take: sitting at one end of a horizontal row, with real content making up the rest. Figma already has a native way to push content to one end of a row, `primaryAxisAlignItems`, and it does not need to know a pixel value at all. A leading spacer is spliced out and the row's alignment is set to push the remaining content to the far end instead; a trailing one is spliced out and the row's default alignment already leaves the content where it was.

The remaining content still needs a real width from somewhere, and the first version of this fix got that part wrong: it switched the content from FILL to HUG, on the reasoning that it no longer had a sibling to fill remaining space against. That produced the identical deadlock one level down instead of fixing anything. `v1-v2-wrapper` became HUG, but its own two children, `v1-column` and `v2-column`, were still FILL, each expecting a real number FROM the wrapper. HUG derives a width from its children; FILL asks its parent for one. Point those two at each other and neither has anywhere to start, which is exactly what a HUG parent holding FILL children is, one level further down the tree than the version of this bug already covered above. The columns rendered as though squeezed into almost no width at all, one character per line.

The actual fix: the remaining content is given a `FIXED` width, taken from what the sandbox measured it at, rather than either relative instruction. A real number is the one thing that lets its own FILL children resolve against it correctly, splitting that measured width between them the same way the browser's own flex-grow did.

This only fires when a spacer sits at either end of a row with nothing after it on that side; a spacer in the middle of several real children is a different, rarer shape and is left for whenever it actually comes up.

**The lesson, stated plainly:** FILL asks a parent for a real number, and HUG asks its children for one. Neither one produces a number on its own, so somewhere along every chain, something has to be FIXED, or resolved from actual text content, or the whole chain has nothing to agree on. Reaching for "the other relative keyword" when one relative keyword fails is not a fix, it just moves the same deadlock to a different pair of nodes. When a FILL or a HUG turns out to be resolving against nothing, the way out is a real number, not a different relative instruction.

### align-items: stretch

The default cross-axis behaviour in flexbox, and the one this converter used to just discard: a row with `align-items: stretch`, which is what a row gets when nothing else is specified at all, makes every child match the height of the tallest one. A shorter sibling does not stay short; its own background extends down to fill the gap. `fix-row` sets this explicitly, and `v1-v2-wrapper` gets it for free by not setting anything, which is the more common way to end up with it.

The converter's older behaviour quietly treated `stretch` as `flex-start`, so every child just hugged its own height regardless. That was a deliberate downgrade at the time, for the reason the rest of this document keeps returning to: a naive implementation means giving every child FILL height, and FILL needs a parent with a real number to fill into. A HUG row can't supply one, which is exactly the failure retracted above.

The safe version follows the same pattern that fixed the width problem: measure what the row actually stretched to in the real sandbox, pin the row itself to that as a `FIXED` height, then let the real content frames FILL against that concrete anchor rather than against each other. A bare line of text, an arrow with no background of its own, is left out of the FILL and centred in the row instead, using Figma's own native alignment: Figma resizes a text node's own height automatically, and asking it to also FILL was never tested alongside that, so the untested combination is avoided rather than assumed safe. Since a filled child ignores the row's alignment entirely, centring the row affects only whatever bare text was left out, with no effect on the frames beside it.

### Layer names

A frame's Figma name is tried in order, each step only reached if the one before it found nothing: `data-name`, then `id`, then `class`, then a slug built from the element's own text content, then the tag plus its position among its siblings.

`data-name` is the html-diagram-for-figma skill's own attribute. It is not standard HTML and does nothing in a browser; it exists purely so the skill can hand this converter a real label. Nothing else in ordinary HTML ever writes it, so its presence is a clean signal, and it wins outright over everything else. The skill itself (`/html-diagram-for-figma/SKILL.md` in this monorepo) tells a Claude building an HTML diagram for this plugin to add it to every meaningful div; it is scoped narrowly, triggering only when the HTML is headed for HTMLizer, so it never touches an ordinary page or document.

`id` is the one attribute most HTML authors reach for to label something, with no idea this converter exists. It can be framework noise, a generated counter or a hash, but noise here still beats no name, so it is used as written.

The text slug exists for a frame that has real words inside it but no name of any kind: a plain `<div>` full of other unnamed divs. It reads whatever text is nested anywhere inside, lowercases and hyphenates it, and truncates. It is deliberately not clever about it: no picking the most distinctive word, no reordering, just what was there.

The last resort is the tag plus a sibling index, `div-3`. It is not a name, it is a way to tell six identical unlabelled divs apart in the layer list, and a place to start renaming from. It only fires when an element has nothing else at all, typically an empty structural or spacer div with no text nested inside it either.

None of this is required for the converter to work. Paste a document with no classes, no ids and no `data-name` anywhere, and every layer still comes out named, just less specifically, exactly as it always did before any of this was added.

## Known limits

Real Figma constraints, not laziness:

- **Strokes are one colour for all four sides.** Per side widths are fine. Different colours per side warns and the widest side wins. Related finding: a single stroke with a thicker left edge tapers nicely into the rounded corners, which a separate stripe child cannot do. Grant likes this, so uniform colour with varied widths is the preferred house style.
- **Text nodes cannot hold padding, fill or strokes.** Anything needing them gets a wrapper frame, named `<text> box`.
- **A relative size on one axis, such as `height: 100%`, only ever resolves against a parent with a real size on that axis.** If the parent is itself going to hug, the child is measured and pinned to a fixed number instead of trusted to fill. See "The percentage height trap" above.
- **Baseline alignment is unavailable** when a child's own size on that axis is FIXED rather than HUG, which any card that has been given an explicit height is. Rarely a loss for card layouts.
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

**A screenshot of the frame in isolation can look completely correct while the frame's own layout-affecting size is wrong.** Figma paints a frame's children at their real, individually-resolved size regardless of what the frame's own reported width or height says, so a broken hug height that stuck at Figma's default size still shows every leaf inside it rendered fine. The tell only shows up one level further out: the *next* section, positioned by the parent using that frame's wrong size, ends up overlapping or misplaced. `get_metadata`'s reported height can be equally misleading for the same reason. When a screenshot of the one frame in question looks right but something still feels off, screenshot the whole page next, not another close-up.

**A row of similar-looking cards passing review is not the same as FILL having been verified.** The equal-height-cards fix in this file was called safe on the strength of row1 and fix-row looking fine, and it wasn't safe; their cards just happened to be similar enough in length that a silently wrong FILL and a correctly resolved HUG would have looked identical either way. The thing that actually caught it was Grant testing two genuinely different-length siblings side by side and toggling one by hand in the Figma properties panel. When a sizing rule is claimed to work, ask whether it was tested with content that would actually show the difference, not just content where it wouldn't matter if it were wrong.

Change one thing at a time. Three of the fixes during the build looked correct in reasoning and were wrong in Figma, and they were only separable because they were tested separately.

## Cost note

Generating HTML and converting locally is roughly five to ten times cheaper in tokens than building the same layout node by node through the Figma MCP, because the MCP loads about forty tool schemas, every node is a verbose structured call, and verifying the result needs screenshots. Figma MCP earns its cost reading an existing design or making a surgical change in a large file, not generating something new.

## Ideas not yet built

- Remsoft mode: map class names to real text styles and colour variables instead of raw hex.
- Component instances instead of plain frames for repeated cards.
- MCP transport, if pasting ever becomes the annoying part.
