figma.showUI(__html__, { width: 470, height: 560, themeColors: true });

let counts = { frames: 0, texts: 0, spacers: 0 };
const fallbacks = [];
const notes = [];

function note(m) { if (notes.indexOf(m) === -1) notes.push(m); }
function solid(c) { return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }; }

function collectFonts(node, set) {
  if (node.kind === 'TEXT') set.add(node.fontFamily + '||' + node.fontStyle);
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
  t.textAlignHorizontal = spec.hAlign || 'LEFT';
  t.textAutoResize = 'HEIGHT';
  t.name = spec.name;

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
  return buildFrame(spec, fonts);
}

figma.ui.onmessage = async function (msg) {
  if (msg.type !== 'build') return;
  counts = { frames: 0, texts: 0, spacers: 0 };
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
      fontFallbacks: fallbacks,
      notes: notes,
      warnings: msg.warnings || []
    });
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: e.message });
  }
};
