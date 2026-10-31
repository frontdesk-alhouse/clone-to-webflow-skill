// FIGMA SHIM v0 — walks a Figma subtree and emits synthetic HTML with inline styles
// so Impeccable's static-html detector can run its rules against a Figma frame.
// Runs inside use_figma. Params injected above: PAGE_ID, ROOT_ID, OFFSET, CHUNK.

const page = figma.root.children.find(p => p.id === PAGE_ID);
await figma.setCurrentPageAsync(page);
const root = await figma.getNodeByIdAsync(ROOT_ID);
if (!root) throw new Error('root not found: ' + ROOT_ID);

const CONTAINERS = { FRAME: 1, GROUP: 1, COMPONENT: 1, COMPONENT_SET: 1, INSTANCE: 1, SECTION: 1 };
const SKIP_SMALL_SHAPES = { VECTOR: 1, ELLIPSE: 1, POLYGON: 1, STAR: 1, LINE: 1, BOOLEAN_OPERATION: 1 };
const MIXED = figma.mixed;

const cl = (v) => Math.max(0, Math.min(1, v));
const h2 = (v) => ('0' + Math.round(cl(v) * 255).toString(16)).slice(-2);
const hex = (c) => '#' + h2(c.r) + h2(c.g) + h2(c.b);
const rgba = (c, a) => 'rgba(' + Math.round(cl(c.r) * 255) + ',' + Math.round(cl(c.g) * 255) + ',' + Math.round(cl(c.b) * 255) + ',' + (Math.round(a * 100) / 100) + ')';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const px = (v) => Math.round(v) + 'px';

function paintOf(node, prop) {
  const f = node[prop];
  if (!f || f === MIXED || !f.length) return null;
  for (let i = f.length - 1; i >= 0; i--) {
    const p = f[i];
    if (p.visible === false) continue;
    if (p.type === 'SOLID') {
      const a = (p.opacity == null ? 1 : p.opacity);
      return { solid: a < 1 ? rgba(p.color, a) : hex(p.color) };
    }
    if (p.type.indexOf('GRADIENT') === 0) {
      const stops = (p.gradientStops || []).map(s => hex(s.color)).join(', ');
      return { gradient: 'linear-gradient(180deg, ' + (stops || '#000, #fff') + ')' };
    }
    if (p.type === 'IMAGE') return { image: 1 };
  }
  return null;
}

function borderCss(node) {
  const s = node.strokes;
  if (!s || s === MIXED || !s.length) return '';
  let vis = null;
  for (const p of s) { if (p.visible !== false && p.type === 'SOLID') { vis = p; break; } }
  if (!vis) return '';
  const a = (vis.opacity == null ? 1 : vis.opacity);
  const col = a < 1 ? rgba(vis.color, a) : hex(vis.color);
  const w = node.strokeWeight;
  if (w === MIXED) {
    let out = '';
    const sides = [['Top', 'top'], ['Right', 'right'], ['Bottom', 'bottom'], ['Left', 'left']];
    for (const pair of sides) {
      const v = node['stroke' + pair[0] + 'Weight'];
      if (typeof v === 'number' && v > 0) {
        out += 'border-' + pair[1] + '-style:solid;border-' + pair[1] + '-width:' + px(v) + ';border-' + pair[1] + '-color:' + col + ';';
      }
    }
    return out;
  }
  if (typeof w === 'number' && w > 0) {
    return 'border-style:solid;border-width:' + px(w) + ';border-color:' + col + ';';
  }
  return '';
}

function radiusCss(node) {
  const r = node.cornerRadius;
  if (typeof r === 'number' && r > 0) return 'border-radius:' + px(r) + ';';
  if (r === MIXED) {
    const tl = node.topLeftRadius || 0, tr = node.topRightRadius || 0;
    const br = node.bottomRightRadius || 0, bl = node.bottomLeftRadius || 0;
    if (tl || tr || br || bl) return 'border-radius:' + px(tl) + ' ' + px(tr) + ' ' + px(br) + ' ' + px(bl) + ';';
  }
  return '';
}

function shadowCss(node) {
  const e = node.effects;
  if (!e || e === MIXED || !e.length) return '';
  const parts = [];
  for (const f of e) {
    if (f.visible === false) continue;
    if (f.type === 'DROP_SHADOW' || f.type === 'INNER_SHADOW') {
      const a = (f.color && f.color.a != null) ? f.color.a : 1;
      parts.push((f.type === 'INNER_SHADOW' ? 'inset ' : '') + px(f.offset.x) + ' ' + px(f.offset.y) + ' ' + px(f.radius) + ' ' + px(f.spread || 0) + ' ' + rgba(f.color, a));
    }
  }
  return parts.length ? 'box-shadow:' + parts.join(', ') + ';' : '';
}

// Auto-layout frames carry real padding. Frames without it still have a visual
// inset — derive it from the children's bounding box, otherwise every absolutely
// positioned Figma frame reads to the detector as "children flush against the edge".
function layoutCss(node) {
  const lm = node.layoutMode;
  let pt = 0, pr = 0, pb = 0, pl = 0, gap = 0;
  if (lm && lm !== 'NONE') {
    pt = node.paddingTop || 0; pr = node.paddingRight || 0;
    pb = node.paddingBottom || 0; pl = node.paddingLeft || 0;
    gap = typeof node.itemSpacing === 'number' ? node.itemSpacing : 0;
  } else {
    if (!CONTAINERS[node.type]) return '';
    const kids = node.children;
    if (!kids || !kids.length) return '';
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of kids) {
      if (c.visible === false) continue;
      const cx = c.x || 0, cy = c.y || 0, cw = c.width || 0, ch = c.height || 0;
      if (cx < x0) x0 = cx;
      if (cy < y0) y0 = cy;
      if (cx + cw > x1) x1 = cx + cw;
      if (cy + ch > y1) y1 = cy + ch;
    }
    if (!isFinite(x0)) return '';
    pl = Math.max(0, x0); pt = Math.max(0, y0);
    pr = Math.max(0, (node.width || 0) - x1); pb = Math.max(0, (node.height || 0) - y1);
  }
  let out = '';
  if (pt > 0 && pt < 200) out += 'padding-top:' + px(pt) + ';';
  if (pr > 0 && pr < 200) out += 'padding-right:' + px(pr) + ';';
  if (pb > 0 && pb < 200) out += 'padding-bottom:' + px(pb) + ';';
  if (pl > 0 && pl < 200) out += 'padding-left:' + px(pl) + ';';
  if (gap > 0) out += 'gap:' + px(gap) + ';';
  return out;
}

const WEIGHTS = { thin: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };

// fontName/fontSize come back as figma.mixed on multi-style text — fall back to
// the first styled segment, otherwise font-family never reaches the detector.
function resolveFont(node) {
  const fn = node.fontName;
  if (fn && fn !== MIXED) return fn;
  try { const s = node.getStyledTextSegments(['fontName']); if (s && s.length) return s[0].fontName; } catch (e) {}
  return null;
}
function resolveSize(node) {
  const fs = node.fontSize;
  if (typeof fs === 'number') return fs;
  try { const s = node.getStyledTextSegments(['fontSize']); if (s && s.length) return s[0].fontSize; } catch (e) {}
  return null;
}

function textCss(node) {
  let out = '';
  const fn = resolveFont(node);
  if (fn) {
    out += 'font-family:' + fn.family + ';';
    const st = String(fn.style || '').toLowerCase().replace(/\s+/g, '');
    const base = st.replace('italic', '') || 'regular';
    out += 'font-weight:' + (WEIGHTS[base] || (st.indexOf('bold') >= 0 ? 700 : 400)) + ';';
    if (st.indexOf('italic') >= 0) out += 'font-style:italic;';
  }
  const fs = resolveSize(node);
  if (typeof fs === 'number') out += 'font-size:' + px(fs) + ';';
  const lh = node.lineHeight;
  if (lh && lh !== MIXED) {
    if (lh.unit === 'PIXELS') out += 'line-height:' + px(lh.value) + ';';
    else if (lh.unit === 'PERCENT') out += 'line-height:' + (Math.round(lh.value) / 100) + ';';
  }
  const ls = node.letterSpacing;
  if (ls && ls !== MIXED && ls.value) {
    if (ls.unit === 'PIXELS') out += 'letter-spacing:' + px(ls.value) + ';';
    else if (ls.unit === 'PERCENT' && typeof fs === 'number') out += 'letter-spacing:' + px(fs * ls.value / 100) + ';';
  }
  const tc = node.textCase;
  if (tc === 'UPPER') out += 'text-transform:uppercase;';
  else if (tc === 'LOWER') out += 'text-transform:lowercase;';
  else if (tc === 'TITLE') out += 'text-transform:capitalize;';
  const ta = node.textAlignHorizontal;
  if (ta === 'JUSTIFIED') out += 'text-align:justify;';
  else if (ta === 'CENTER') out += 'text-align:center;';
  else if (ta === 'RIGHT') out += 'text-align:right;';
  return out;
}

// --- miniature detection: a subtree that is a scaled-down mock UI reads as an image ---
const miniCache = {};
function isMiniature(node) {
  if (!CONTAINERS[node.type]) return false;
  if (miniCache[node.id] != null) return miniCache[node.id];
  let ts;
  try { ts = node.findAll(n => n.type === 'TEXT'); } catch (e) { ts = []; }
  let small = 0, counted = 0;
  for (const t of ts) {
    const s = resolveSize(t);
    if (typeof s === 'number') { counted++; if (s < 11) small++; }
  }
  const r = counted >= 3 && (small / counted) >= 0.7;
  miniCache[node.id] = r;
  return r;
}

// --- pass 1: heading ladder from content text only ---
const contentSizes = {};
(function collect(node, inMini) {
  if (node.visible === false) return;
  const mini = inMini || isMiniature(node);
  if (node.type === 'TEXT' && !mini) {
    const fs = resolveSize(node);
    if (typeof fs === 'number' && fs >= 20) contentSizes[Math.round(fs)] = (contentSizes[Math.round(fs)] || 0) + 1;
  }
  if (mini) return;
  const kids = CONTAINERS[node.type] ? node.children : null;
  if (kids) for (const k of kids) collect(k, mini);
})(root, false);

const ladder = Object.keys(contentSizes).map(Number).sort((a, b) => b - a).slice(0, 3);
const tagForSize = (fs) => {
  if (typeof fs !== 'number') return 'p';
  const r = Math.round(fs);
  const i = ladder.indexOf(r);
  if (i === 0) return 'h1';
  if (i === 1) return 'h2';
  if (i === 2) return 'h3';
  return 'p';
};

// --- pass 2: emit ---
const lines = [];
function emit(node, inMini, depth) {
  if (node.visible === false) return;
  if (typeof node.opacity === 'number' && node.opacity === 0) return;
  if (depth > 40) return;

  const mini = isMiniature(node);
  if (mini && !inMini) {
    const w = Math.round(node.width || 0), h = Math.round(node.height || 0);
    lines.push('<img data-fid="' + node.id + '" alt="' + esc(String(node.name).slice(0, 40)) + '" width="' + w + '" height="' + h + '" src="mock.png">');
    return;
  }

  if (SKIP_SMALL_SHAPES[node.type]) {
    const w = node.width || 0, h = node.height || 0;
    if (w < 32 || h < 32) return; // decorative icon glyph
  }

  const fill = paintOf(node, 'fills');
  const deco0 = borderCss(node) + radiusCss(node) + shadowCss(node);
  const boxy = !!(fill || deco0);
  const w = node.width, h = node.height;
  const iconish = typeof w === 'number' && typeof h === 'number' && w >= 32 && w <= 128 && h >= 32 && h <= 128;

  let style = '';
  if (typeof w === 'number' && w > 0 && (node.type === 'TEXT' || boxy || iconish)) style += 'width:' + px(w) + ';';
  if (typeof h === 'number' && h > 0 && node.type !== 'TEXT' && (boxy || iconish)) style += 'height:' + px(h) + ';';

  if (node.type === 'TEXT') {
    style += textCss(node);
    if (fill && fill.solid) style += 'color:' + fill.solid + ';';
    else if (fill && fill.gradient) style += 'background-image:' + fill.gradient + ';-webkit-background-clip:text;background-clip:text;color:transparent;';
  } else {
    if (fill && fill.solid) style += 'background-color:' + fill.solid + ';';
    else if (fill && fill.gradient) style += 'background-image:' + fill.gradient + ';';
    else if (fill && fill.image) style += 'background-image:url(img.png);';
  }
  const deco = deco0;
  const kidsNow = CONTAINERS[node.type] ? node.children : null;
  // A leaf with no paint, no border, no shadow and no radius contributes to no rule.
  // Emitting it only inflates the payload, so drop it.
  if (node.type !== 'TEXT' && !fill && !deco && (!kidsNow || !kidsNow.length)) return;
  style += deco + layoutCss(node);
  if (node.clipsContent && boxy) style += 'overflow:hidden;';
  if (typeof node.opacity === 'number' && node.opacity < 1) style += 'opacity:' + (Math.round(node.opacity * 100) / 100) + ';';

  const attrs = ' data-fid="' + node.id + '" style="' + style + '"';

  if (node.type === 'TEXT') {
    const chars = String(node.characters == null ? '' : node.characters);
    const tag = inMini ? 'span' : tagForSize(resolveSize(node));
    lines.push('<' + tag + attrs + '>' + esc(chars.slice(0, 400)) + '</' + tag + '>');
    return;
  }

  const kids = CONTAINERS[node.type] ? node.children : null;
  if (!kids || !kids.length) {
    lines.push('<div' + attrs + '></div>');
    return;
  }
  lines.push('<div' + attrs + '>');
  for (const k of kids) emit(k, inMini || mini, depth + 1);
  lines.push('</div>');
}

const rootFill = paintOf(root, 'fills');
const bodyStyle = 'margin:0;width:' + px(root.width) + ';' + (rootFill && rootFill.solid ? 'background-color:' + rootFill.solid + ';' : '');
for (const k of (root.children || [])) emit(k, false, 0);

const html = '<!doctype html>\n<html><head><title>' + esc(root.name) + '</title></head>\n<body style="' + bodyStyle + '">\n' + lines.join('\n') + '\n</body></html>\n';

return {
  meta: { root: root.id, name: root.name, elements: lines.length, ladder: ladder, len: html.length },
  part: html.slice(OFFSET, OFFSET + CHUNK),
  done: OFFSET + CHUNK >= html.length
};
