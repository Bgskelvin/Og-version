/* =====================================================================
   template-render.js — draws photo design templates.
   Used by the template editor (Admin) and the Edit photo page (guests), so
   what Admin sees in the editor is exactly what the guest's photo looks like.
   Layer order: background color → background image → photos 1-4 → PNG frame → text
   Template data fields (latarWarna, latarUrl, bingkaiUrl, diubah, …) come from
   the main process and are renamed with it in refactor/main-english.
   ===================================================================== */

export const TEMPLATE_FONTS = {
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  script: '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive',
};
export const FONT_NAMES = { sans: 'Modern', serif: 'Classic', script: 'Handwriting' };

// {couple} and {tanggal} are filled in automatically when the photo is made.
// In the template editor, {couple} uses the name of the couple being edited (null = active couple).
let templateCoupleName = null;
export const setTemplateCoupleName = name => {
  templateCoupleName = name;
};
export function fillTemplateText(text) {
  const date = tanggalHariIni(); // date format follows the guest screen language
  const name = templateCoupleName !== null ? templateCoupleName : activeCouple ? activeCouple.name : '';
  return String(text || '')
    .replace(/\{couple\}/gi, name)
    .replace(/\{tanggal\}/gi, date);
}
const textFont = t => `${t.bold ? 700 : 400} ${t.size}px ${TEMPLATE_FONTS[t.font] || TEMPLATE_FONTS.sans}`;

// The image fills the box without squashing (cropped from the center)
function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width,
    ih = img.naturalHeight || img.height;
  const s = Math.max(w / iw, h / ih),
    sw = w / s,
    sh = h / s;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}
export function loadImage(src) {
  return new Promise(res => {
    if (!src) return res(null);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

// Prepare a template: load the background & frame images once, then cache them
const templateCache = new Map();
export async function prepareTemplate(tpl) {
  const cacheKey = tpl.id + ':' + (tpl.diubah || 0);
  if (templateCache.has(cacheKey)) return templateCache.get(cacheKey);
  const prepared = { tpl, background: await loadImage(tpl.latarUrl), frame: await loadImage(tpl.bingkaiUrl) };
  templateCache.set(cacheKey, prepared);
  return prepared;
}

/* Draw one template. `prepared` = { tpl, background, frame } from prepareTemplate().
   options.photos      canvases of photos 1-4 (empty = not drawn)
   options.filter      CSS filter for the photos
   options.placeholder true = empty photo boxes drawn as numbered gray boxes (for the editor) */
export function drawTemplate(ctx, prepared, options = {}) {
  const { tpl, background, frame } = prepared;
  const { scale = 1, photos = [], filter = 'none', placeholder = false } = options;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = tpl.latarWarna || '#FFFFFF';
  ctx.fillRect(0, 0, tpl.W, tpl.H);
  if (background) drawCover(ctx, background, 0, 0, tpl.W, tpl.H);

  tpl.slots.forEach((s, i) => {
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(s.x, s.y, s.w, s.h, s.r || 0);
    else ctx.rect(s.x, s.y, s.w, s.h);
    ctx.clip();
    if (photos[i]) {
      ctx.filter = filter;
      drawCover(ctx, photos[i], s.x, s.y, s.w, s.h);
    } else if (placeholder) {
      ctx.fillStyle = 'rgba(120,120,128,.35)';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.font = `700 ${Math.max(24, Math.min(s.w, s.h) * 0.35)}px ${TEMPLATE_FONTS.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), s.x + s.w / 2, s.y + s.h / 2);
    }
    ctx.restore();
  });

  if (frame) ctx.drawImage(frame, 0, 0, tpl.W, tpl.H);

  for (const t of tpl.texts) {
    const content = fillTemplateText(t.text);
    if (!content) continue;
    ctx.font = textFont(t);
    ctx.fillStyle = t.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(content, t.x, t.y);
  }
  ctx.restore();
}

// Text width (in template units) for the selection box in the editor
let measureCtx = null;
export function textWidth(t) {
  const c = measureCtx || (measureCtx = document.createElement('canvas').getContext('2d'));
  c.font = textFont(t);
  return c.measureText(fillTemplateText(t.text) || ' ').width;
}

/* Photo-box ratio (width : height). Chosen in Admin per template; photos 1-4 all use it.
   The Sony camera shoots 3:2, webcams are usually 16:9. Other ratios mean the photo is cropped. */
export const PHOTO_RATIOS = [
  ['3:2', 3 / 2],
  ['4:3', 4 / 3],
  ['16:9', 16 / 9],
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['3:4', 3 / 4],
  ['2:3', 2 / 3],
];
export const ratioValue = key => {
  const r = PHOTO_RATIOS.find(x => x[0] === key);
  return r ? r[1] : null;
};
// Largest box with ratio r that fits in cw × ch
export const fitRatio = (cw, ch, r) => (cw / ch > r ? [ch * r, ch] : [cw, cw / r]);
// Change one photo box to ratio r: keeps its center & area, stays inside the template
export function applyRatio(s, r, W, H) {
  let w = Math.sqrt(s.w * s.h * r),
    h = w / r;
  const k = Math.min(1, W / w, H / h);
  w *= k;
  h *= k;
  const cx = s.x + s.w / 2,
    cy = s.y + s.h / 2;
  const x = Math.min(W - w, Math.max(0, cx - w / 2)),
    y = Math.min(H - h, Math.max(0, cy - h / 2));
  return { ...s, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/* Quick arrangements of photos 1-4, fitted to the template size.
   The bottom is left free for text (couple name & date).
   kind: 'kisi' (grid), 'kolom' (column), 'baris' (row), 'besar' (1 large + 3 small).
   With a ratio: every box uses that ratio, then the arrangement is centered. */
export function photoArrangement(kind, W, H, ratio = null) {
  const m = Math.round(Math.min(W, H) * 0.05),
    g = Math.round(Math.min(W, H) * 0.025);
  const landscape = W > H;
  const x0 = m,
    y0 = m,
    aw = W - 2 * m,
    ah = Math.round(H * (landscape ? 0.8 : 0.84)) - m;
  const r = 8,
    k = [];
  if (ratio) {
    const rows = []; // each row: list of [width, height]
    if (kind === 'kisi') {
      const c = fitRatio((aw - g) / 2, (ah - g) / 2, ratio);
      rows.push([c, c], [c, c]);
    } else if (kind === 'kolom') {
      const c = fitRatio(aw, (ah - 3 * g) / 4, ratio);
      for (let i = 0; i < 4; i++) rows.push([c]);
    } else if (kind === 'baris') {
      const c = fitRatio((aw - 3 * g) / 4, ah, ratio);
      rows.push([c, c, c, c]);
    } else {
      rows.push([fitRatio(aw, (ah - g) * 0.62, ratio)]);
      const c = fitRatio((aw - 2 * g) / 3, (ah - g) * 0.38, ratio);
      rows.push([c, c, c]);
    }
    const totalHeight = rows.reduce((t, b) => t + b[0][1], 0) + g * (rows.length - 1);
    let y = y0 + (ah - totalHeight) / 2;
    for (const b of rows) {
      const rowWidth = b.reduce((t, c) => t + c[0], 0) + g * (b.length - 1);
      let x = x0 + (aw - rowWidth) / 2;
      for (const [w, h] of b) {
        k.push({ x, y, w, h, r });
        x += w + g;
      }
      y += b[0][1] + g;
    }
    return k.map(s => ({ x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.w), h: Math.round(s.h), r: s.r }));
  }
  if (kind === 'kisi') {
    const w = (aw - g) / 2,
      h = (ah - g) / 2;
    for (let i = 0; i < 4; i++) k.push({ x: x0 + (i % 2) * (w + g), y: y0 + Math.floor(i / 2) * (h + g), w, h, r });
  } else if (kind === 'kolom') {
    const h = (ah - 3 * g) / 4;
    for (let i = 0; i < 4; i++) k.push({ x: x0, y: y0 + i * (h + g), w: aw, h, r });
  } else if (kind === 'baris') {
    const w = (aw - 3 * g) / 4;
    for (let i = 0; i < 4; i++) k.push({ x: x0 + i * (w + g), y: y0, w, h: ah, r });
  } else {
    // 'besar': 1 large on top, 3 small below
    const bh = (ah - g) * 0.62,
      sh = ah - g - bh,
      sw = (aw - 2 * g) / 3;
    k.push({ x: x0, y: y0, w: aw, h: bh, r });
    for (let i = 0; i < 3; i++) k.push({ x: x0 + i * (sw + g), y: y0 + bh + g, w: sw, h: sh, r });
  }
  return k.map(s => ({ x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.w), h: Math.round(s.h), r: s.r }));
}
export function defaultTexts(W, H) {
  const landscape = W > H,
    s = Math.min(W, H);
  return [
    {
      id: 't1',
      text: '{couple}',
      x: W / 2,
      y: Math.round(H * (landscape ? 0.88 : 0.905)),
      size: Math.round(s * (W < 700 ? 0.085 : 0.07)),
      color: '#1D1D1F',
      font: 'script',
      bold: false,
    },
    {
      id: 't2',
      text: '{tanggal}',
      x: W / 2,
      y: Math.round(H * (landscape ? 0.95 : 0.96)),
      size: Math.round(s * 0.03),
      color: '#6E6E73',
      font: 'sans',
      bold: false,
    },
  ];
}
