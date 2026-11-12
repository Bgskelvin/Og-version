/* =====================================================================
   template.js — Photo Booth photo design templates (per couple)
   Stored in <data folder>/templates/<id>/:
     template.json   size, background color, positions of photos 1-4, texts
     latar.png/jpg   background image (optional, from Canva/Photoshop)
     bingkai.png     transparent PNG drawn over the photos (optional)
   Field names (nama, ukuran, latarWarna, …) and the image names latar/bingkai
   are stored on disk and shared with the UI.
   ===================================================================== */
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { userData, readJSON, writeJSON } = require('./storage');
const log = require('./log');

const templatesDir = path.join(userData, 'templates');
const SIZES = {
  // output size in pixels (300 dpi)
  '4r-tegak': { W: 1200, H: 1800, nama: '4R portrait (4×6)' },
  '4r-datar': { W: 1800, H: 1200, nama: '4R landscape (6×4)' },
  strip: { W: 600, H: 1800, nama: 'Strip 2×6' },
  persegi: { W: 1200, H: 1200, nama: 'Square' },
};
const MAX_IMAGE = 25 * 1024 * 1024; // size limit for uploaded image files
const FONTS = ['sans', 'serif', 'script'];
const RATIOS = ['3:2', '4:3', '16:9', '1:1', '4:5', '3:4', '2:3']; // photo box ratio (width:height)
const IMAGES = ['latar', 'bingkai']; // background, frame

const number = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const color = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : d);

// Clean the data from the editor so it is always valid
function cleanTemplate(t) {
  const size = SIZES[t.ukuran] ? t.ukuran : '4r-tegak';
  const { W, H } = SIZES[size];
  const slots = (Array.isArray(t.slots) ? t.slots : []).slice(0, 4).map(s => {
    const w = number(s.w, 40, W, W / 2),
      h = number(s.h, 40, H, H / 4);
    return {
      x: number(s.x, -w / 2, W - w / 2, 0),
      y: number(s.y, -h / 2, H - h / 2, 0),
      w,
      h,
      r: number(s.r, 0, 200, 8),
    };
  });
  while (slots.length < 4) slots.push({ x: 40, y: 40 + slots.length * 60, w: W / 3, h: H / 6, r: 8 });
  const texts = (Array.isArray(t.texts) ? t.texts : []).slice(0, 12).map((x, i) => ({
    id: String(x.id || 't' + i).slice(0, 20),
    text: String(x.text || '').slice(0, 120),
    x: number(x.x, 0, W, W / 2),
    y: number(x.y, 0, H, H / 2),
    size: number(x.size, 10, 400, 60),
    color: color(x.color, '#1D1D1F'),
    font: FONTS.includes(x.font) ? x.font : 'sans',
    bold: !!x.bold,
  }));
  return {
    id:
      String(t.id || 'tpl' + Date.now())
        .replace(/[^a-z0-9_-]/gi, '')
        .slice(0, 40) || 'tpl' + Date.now(),
    coupleId: String(t.coupleId || ''),
    nama:
      String(t.nama || '')
        .trim()
        .slice(0, 60) || 'Untitled template',
    ukuran: size,
    W,
    H,
    latarWarna: color(t.latarWarna, '#FFFFFF'),
    rasio: RATIOS.includes(t.rasio) ? t.rasio : null,
    // Photo filter (.cube LUT from main/filter.js). Empty = no filter.
    filter:
      String(t.filter || '')
        .replace(/[^a-z0-9_-]/gi, '')
        .slice(0, 40) || null,
    filterKekuatan: Math.round(number(t.filterKekuatan, 0, 100, 100)),
    filterTamu: t.filterTamu !== false, // guests may still pick another filter
    slots,
    texts,
  };
}

const folder = id => path.join(templatesDir, id);
const imageType = bytes =>
  bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : null;
function dataUrl(file) {
  try {
    const b = fs.readFileSync(file);
    return `data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${b.toString('base64')}`;
  } catch {
    return null;
  }
}
function findImage(id, base) {
  for (const ext of ['png', 'jpg']) {
    const f = path.join(folder(id), `${base}.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}
function deleteImage(id, base) {
  for (const ext of ['png', 'jpg']) {
    try {
      fs.unlinkSync(path.join(folder(id), `${base}.${ext}`));
    } catch {
      /* there is no image in that format */
    }
  }
}

// Templates for one couple, with their images (as data URLs)
function listTemplates(coupleId) {
  let ids;
  try {
    ids = fs.readdirSync(templatesDir);
  } catch {
    return [];
  }
  const out = [];
  for (const id of ids) {
    const t = readJSON(path.join(folder(id), 'template.json'), null);
    if (!t || (coupleId && t.coupleId !== coupleId)) continue;
    const background = findImage(id, 'latar'),
      frame = findImage(id, 'bingkai');
    out.push({ ...t, latarUrl: background && dataUrl(background), bingkaiUrl: frame && dataUrl(frame) });
  }
  return out.sort((a, b) => (a.dibuat || 0) - (b.dibuat || 0));
}

// Number of templates per couple (without loading images), for the couple list in Admin
function countTemplates() {
  const n = {};
  let ids;
  try {
    ids = fs.readdirSync(templatesDir);
  } catch {
    return n;
  }
  for (const id of ids) {
    const t = readJSON(path.join(folder(id), 'template.json'), null);
    if (t && t.coupleId) n[t.coupleId] = (n[t.coupleId] || 0) + 1;
  }
  return n;
}
// Called when a couple is deleted so its templates aren't left behind
function deleteCoupleTemplates(coupleId) {
  if (!coupleId) return 0;
  let ids;
  let n = 0;
  try {
    ids = fs.readdirSync(templatesDir);
  } catch {
    return 0;
  }
  for (const id of ids) {
    const t = readJSON(path.join(folder(id), 'template.json'), null);
    if (t && t.coupleId === coupleId) {
      try {
        fs.rmSync(folder(id), { recursive: true, force: true });
        n++;
      } catch (e) {
        log.warn(`Template ${id} could not be deleted: ${e.message}`);
      }
    }
  }
  return n;
}

function register() {
  ipcMain.handle('template-ukuran', () => SIZES);
  ipcMain.handle('count-templates', () => countTemplates());
  ipcMain.handle('list-templates', (e, coupleId) => listTemplates(coupleId));

  // images: { latar, bingkai } — each a Uint8Array (replace), null (delete), or missing (keep)
  ipcMain.handle('save-template', (e, input, images = {}) => {
    try {
      if (!input || !input.coupleId) return { error: 'No couple selected.' };
      const t = cleanTemplate(input);
      const old = readJSON(path.join(folder(t.id), 'template.json'), null);
      t.dibuat = (old && old.dibuat) || Date.now();
      t.diubah = Date.now();
      fs.mkdirSync(folder(t.id), { recursive: true });
      for (const base of IMAGES) {
        if (!(base in images)) continue;
        deleteImage(t.id, base);
        if (images[base] === null) continue;
        const bytes = Buffer.from(images[base]);
        if (bytes.length > MAX_IMAGE) return { error: 'The image is too large (max 25 MB).' };
        const ext = imageType(bytes);
        if (!ext) return { error: 'The image must be a PNG or JPG.' };
        if (base === 'bingkai' && ext !== 'png')
          return { error: 'The frame must be a PNG so the photo areas can be transparent.' };
        fs.writeFileSync(path.join(folder(t.id), `${base}.${ext}`), bytes);
      }
      writeJSON(path.join(folder(t.id), 'template.json'), t);
      return { ok: true, template: listTemplates(t.coupleId).find(x => x.id === t.id) };
    } catch (err) {
      console.log('Could not save the template: ' + err.message);
      return { error: err.message };
    }
  });

  ipcMain.handle('delete-template', (e, id) => {
    const clean = String(id || '').replace(/[^a-z0-9_-]/gi, '');
    if (!clean) return { error: 'Template not found.' };
    try {
      fs.rmSync(folder(clean), { recursive: true, force: true });
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  });
}

module.exports = { register, listTemplates, cleanTemplate, countTemplates, deleteCoupleTemplates, SIZES };
