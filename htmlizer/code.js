// HTMLizer. Figma sandbox half: receives a JSON tree from ui.html and builds nodes.
//
// =============================================================================
// THE ONE RULE: adapt this converter to the HTML, never the HTML to this
// converter. If a document renders wrong, the bug is here or in ui.html, never
// in the source HTML. Rewriting the HTML to suit the converter was tried and
// rejected: the next document hits the same limitation and its author has no
// way to know the rules. Any CSS this converter mishandles is a converter bug.
//
// Full spec and known limits: README.md in this folder. Read it first.
//
// Two things in this file that look wrong and are not:
//   - Sizing is applied AFTER appendChild, because FILL cannot resolve against
//     a parent that does not exist yet. Do not move applySizing earlier.
//   - layoutSizingHorizontal / Vertical are used in preference to layoutAlign,
//     layoutGrow and counterAxisSizingMode. The old properties conflict with
//     each other and caused the first round of bugs. They survive only as a
//     fallback inside a catch block.
//
// You cannot run Figma from a chat, so you cannot verify a change. Ask for the
// plugin's log line and a screenshot before claiming a fix works.
//
// If this edit changes what the converter actually does, bump the version in
// manifest.json's name field ("HTMLizer vN") and in ui.html's version line, and
// add one line to README.md's Version section. Figma rejects any manifest
// field it does not recognise, so the number lives in the name string, not a
// field of its own. Skip the bump for a comment-only or wording change.
// =============================================================================

figma.showUI(__html__, { width: 470, height: 560, themeColors: true });

let counts = { frames: 0, texts: 0, spacers: 0, svgs: 0 };
const fallbacks = [];
const notes = [];

function note(m) { if (notes.indexOf(m) === -1) notes.push(m); }
function solid(c) { return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }; }

function collectFonts(node, set) {
  if (node.kind === 'TEXT') {
    set.add(node.fontFamily + '||' + node.fontStyle);
    (node.runs || []).forEach(function (r) { set.add(r.fontFamily + '||' + r.fontStyle); });
  }
  if (node.children) node.children.forEach(function (c) { collectFonts(c, set); });
}

async function loadFonts(tree) {
  const set = new Set();
  collectFonts(tree, set);
  const resolved = {};
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  for (const key of set) {
    const parts = key.split('||');
    const want = { family: parts[0], style: parts[1] };
    try {
      await figma.loadFontAsync(want);
      resolved[key] = want;
    } catch (e) {
      let alt = { family: 'Inter', style: parts[1] };
      try { await figma.loadFontAsync(alt); } catch (e2) { alt = { family: 'Inter', style: 'Regular' }; }
      resolved[key] = alt;
      if (fallbacks.indexOf(parts[0]) === -1) fallbacks.push(parts[0]);
    }
  }
  return resolved;
}

function applyStrokes(node, spec) {
  if (!spec.borders || !spec.borders.colour) return;
  const w = spec.borders.widths;
  if (!(w.top || w.right || w.bottom || w.left)) return;
  node.strokes = [solid(spec.borders.colour)];
  node.strokeAlign = 'INSIDE';
  try {
    node.strokeTopWeight = w.top;
    node.strokeRightWeight = w.right;
    node.strokeBottomWeight = w.bottom;
    node.strokeLeftWeight = w.left;
  } catch (e) {
    node.strokeWeight = Math.max(w.top, w.right, w.bottom, w.left);
    note('This Figma version has no per side stroke weights, so borders came in uniform.');
  }
}

// Sizing only resolves once the node is inside an auto layout parent.
function applySizing(node, spec) {
  const parent = node.parent;
  const inAuto = parent && parent.layoutMode && parent.layoutMode !== 'NONE';

  if (spec.minWidth) { try { node.minWidth = spec.minWidth; } catch (e) {} }
  if (spec.maxWidth) { try { node.maxWidth = spec.maxWidth; } catch (e) {} }

  if (spec.sizeH === 'FIXED' && spec.fixedWidth) {
    try { node.resize(spec.fixedWidth, Math.max(1, node.height)); } catch (e) {}
  }
  if (spec.sizeV === 'FIXED' && spec.fixedHeight) {
    try { node.resize(Math.max(1, node.width), spec.fixedHeight); } catch (e) {}
  }
  if (!inAuto) return;

  try {
    if (spec.sizeH === 'FILL') node.layoutSizingHorizontal = 'FILL';
    else if (spec.sizeH === 'HUG' && node.type !== 'TEXT') node.layoutSizingHorizontal = 'HUG';
    else if (spec.sizeH === 'FIXED') node.layoutSizingHorizontal = 'FIXED';
  } catch (e) {
    try {
      if (spec.sizeH === 'FILL' && parent.layoutMode === 'HORIZONTAL') node.layoutGrow = 1;
      if (spec.sizeH === 'FILL' && parent.layoutMode === 'VERTICAL') node.layoutAlign = 'STRETCH';
    } catch (e2) {}
  }

  try {
    if (spec.sizeV === 'FILL') node.layoutSizingVertical = 'FILL';
    else if (spec.sizeV === 'HUG' && node.type !== 'TEXT') node.layoutSizingVertical = 'HUG';
    else if (spec.sizeV === 'FIXED') node.layoutSizingVertical = 'FIXED';
  } catch (e) {}
}

function buildText(spec, fonts) {
  const t = figma.createText();
  t.fontName = fonts[spec.fontFamily + '||' + spec.fontStyle];
  t.fontSize = spec.fontSize;
  t.characters = spec.characters;
  t.fills = [solid(spec.colour)];
  if (spec.lineHeight) t.lineHeight = spec.lineHeight;
  if (spec.letterSpacing) t.letterSpacing = { value: spec.letterSpacing, unit: 'PIXELS' };
  if (spec.paragraphSpacing) t.paragraphSpacing = spec.paragraphSpacing;
  if (spec.textCase) t.textCase = spec.textCase;
  t.textAlignHorizontal = spec.hAlign || 'LEFT';
  // Hugging text sizes itself to its own content, a pill's label; everything else keeps a
  // width from its parent and grows downwards as it wraps.
  t.textAutoResize = spec.sizeH === 'HUG' ? 'WIDTH_AND_HEIGHT' : 'HEIGHT';
  t.name = spec.name;

  // Styled ranges: the bold, colour or size of inline tags inside one paragraph.
  (spec.runs || []).forEach(function (r) {
    try {
      t.setRangeFontName(r.start, r.end, fonts[r.fontFamily + '||' + r.fontStyle]);
      t.setRangeFontSize(r.start, r.end, r.fontSize);
      t.setRangeFills(r.start, r.end, [solid(r.colour)]);
      t.setRangeTextCase(r.start, r.end, r.textCase || 'ORIGINAL');
    } catch (e) {
      note('Some inline formatting (bold, colour, size) could not be applied: ' + e.message);
    }
  });

  if (spec.list) {
    const end = t.characters.length;
    try {
      t.setRangeListOptions(0, end, { type: spec.ordered ? 'ORDERED' : 'UNORDERED' });
      t.setRangeIndentation(0, end, 1);
      if (spec.listSpacing) { try { t.listSpacing = spec.listSpacing; } catch (e) {} }
    } catch (e) {
      note('Native list formatting is unavailable here, so bullets came in as plain paragraphs.');
    }
  }
  counts.texts++;
  return t;
}

function buildSpacer(spec) {
  const f = figma.createFrame();
  f.name = spec.name;
  f.layoutMode = 'VERTICAL';
  f.primaryAxisSizingMode = 'FIXED';
  f.fills = [];
  f.clipsContent = false;
  f.resize(1, Math.max(1, spec.height || 1));
  counts.spacers++;
  return f;
}

// createNodeFromSvg is the same importer Figma uses when an SVG file is dragged onto the
// canvas by hand: it parses the markup and returns a real FrameNode holding real vector
// nodes, paths and all, rather than anything this converter has to reconstruct itself.
// Resizing to the sandbox's own measured width and height happens through the ordinary
// applySizing path below, the same as every other fixed-size node, not here.
function buildSvg(spec) {
  try {
    const node = figma.createNodeFromSvg(spec.markup);
    node.name = spec.name;
    counts.svgs++;
    return node;
  } catch (e) {
    note('An <svg> ("' + spec.name + '") failed to import and was replaced with an empty box: ' + e.message);
    const f = figma.createFrame();
    f.name = spec.name + ' (svg failed)';
    f.fills = [];
    counts.frames++;
    return f;
  }
}

function buildFrame(spec, fonts) {
  const f = figma.createFrame();
  f.name = spec.name;
  f.layoutMode = spec.layout;
  f.itemSpacing = spec.gap || 0;
  f.paddingTop = spec.padding.t;
  f.paddingRight = spec.padding.r;
  f.paddingBottom = spec.padding.b;
  f.paddingLeft = spec.padding.l;
  f.cornerRadius = spec.radius || 0;
  f.clipsContent = !!spec.clip;
  f.fills = spec.fill ? [solid(spec.fill)] : [];
  f.primaryAxisAlignItems = spec.align === 'SPACE_BETWEEN' ? 'SPACE_BETWEEN' : (spec.align || 'MIN');
  f.counterAxisAlignItems = spec.crossAlign === 'SPACE_BETWEEN' ? 'MIN' : (spec.crossAlign || 'MIN');
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  applyStrokes(f, spec);

  for (const childSpec of spec.children) {
    const child = build(childSpec, fonts);
    f.appendChild(child);
    applySizing(child, childSpec);
  }
  counts.frames++;
  return f;
}

function build(spec, fonts) {
  if (spec.kind === 'TEXT') return buildText(spec, fonts);
  if (spec.kind === 'SPACER') return buildSpacer(spec);
  if (spec.kind === 'SVG') return buildSvg(spec);
  return buildFrame(spec, fonts);
}

figma.ui.onmessage = async function (msg) {
  if (msg.type !== 'build') return;
  counts = { frames: 0, texts: 0, spacers: 0, svgs: 0 };
  fallbacks.length = 0;
  notes.length = 0;

  try {
    const fonts = await loadFonts(msg.tree);
    const root = build(msg.tree, fonts);
    figma.currentPage.appendChild(root);

    if (msg.tree.fixedWidth) {
      root.counterAxisSizingMode = 'FIXED';
      root.resize(msg.tree.fixedWidth, Math.max(1, root.height));
    }

    root.x = Math.round(figma.viewport.center.x - root.width / 2);
    root.y = Math.round(figma.viewport.center.y - root.height / 2);
    figma.currentPage.selection = [root];
    figma.viewport.scrollAndZoomIntoView([root]);

    figma.ui.postMessage({
      type: 'done',
      frames: counts.frames,
      texts: counts.texts,
      spacers: counts.spacers,
      svgs: counts.svgs,
      fontFallbacks: fallbacks,
      notes: notes,
      warnings: msg.warnings || []
    });
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: e.message });
  }
};
