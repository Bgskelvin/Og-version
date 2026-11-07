/* =====================================================================
   template.js — template desain foto Photo Booth (per couple)
   Disimpan di <folder data>/templates/<id>/:
     template.json   ukuran, warna latar, posisi foto 1-4, teks
     latar.png/jpg   gambar latar (opsional, dari Canva/Photoshop)
     bingkai.png     PNG transparan yang menimpa foto (opsional)
   ===================================================================== */
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { userData, readJSON, writeJSON } = require('./penyimpanan');

const templatesDir = path.join(userData, 'templates');
const UKURAN = {                                   // ukuran hasil dalam piksel (300 dpi)
  '4r-tegak':   { W: 1200, H: 1800, nama: '4R tegak (4×6)' },
  '4r-datar':   { W: 1800, H: 1200, nama: '4R mendatar (6×4)' },
  'strip':      { W: 600,  H: 1800, nama: 'Strip 2×6' },
  'persegi':    { W: 1200, H: 1200, nama: 'Persegi' },
};
const MAX_GAMBAR = 25 * 1024 * 1024;               // batas ukuran file gambar yang diunggah
const FONT = ['sans', 'serif', 'script'];
const RASIO = ['3:2', '4:3', '16:9', '1:1', '4:5', '3:4', '2:3'];   // rasio kotak foto (lebar:tinggi)

const angka = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const warna = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : d);

// Bersihkan data dari editor supaya selalu valid
function bersihkan(t) {
  const ukuran = UKURAN[t.ukuran] ? t.ukuran : '4r-tegak';
  const { W, H } = UKURAN[ukuran];
  const slots = (Array.isArray(t.slots) ? t.slots : []).slice(0, 4).map(s => {
    const w = angka(s.w, 40, W, W / 2), h = angka(s.h, 40, H, H / 4);
    return { x: angka(s.x, -w / 2, W - w / 2, 0), y: angka(s.y, -h / 2, H - h / 2, 0), w, h, r: angka(s.r, 0, 200, 8) };
  });
  while (slots.length < 4) slots.push({ x: 40, y: 40 + slots.length * 60, w: W / 3, h: H / 6, r: 8 });
  const texts = (Array.isArray(t.texts) ? t.texts : []).slice(0, 12).map((x, i) => ({
    id: String(x.id || 't' + i).slice(0, 20),
    text: String(x.text || '').slice(0, 120),
    x: angka(x.x, 0, W, W / 2), y: angka(x.y, 0, H, H / 2),
    size: angka(x.size, 10, 400, 60),
    color: warna(x.color, '#1D1D1F'),
    font: FONT.includes(x.font) ? x.font : 'sans',
    bold: !!x.bold,
  }));
  return {
    id: String(t.id || 'tpl' + Date.now()).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'tpl' + Date.now(),
    coupleId: String(t.coupleId || ''),
    nama: String(t.nama || '').trim().slice(0, 60) || 'Template tanpa nama',
    ukuran, W, H,
    latarWarna: warna(t.latarWarna, '#FFFFFF'),
    rasio: RASIO.includes(t.rasio) ? t.rasio : null,
    // Filter foto (LUT .cube dari main/filter.js). Kosong = tanpa filter.
    filter: String(t.filter || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || null,
    filterKekuatan: Math.round(angka(t.filterKekuatan, 0, 100, 100)),
    filterTamu: t.filterTamu !== false,          // tamu masih boleh memilih filter lain
    slots, texts,
  };
}

const folder = id => path.join(templatesDir, id);
const ekstensi = bytes => (bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : null);
function dataUrl(file) {
  try {
    const b = fs.readFileSync(file);
    return `data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${b.toString('base64')}`;
  } catch (e) { return null; }
}
function cariGambar(id, dasar) {
  for (const ext of ['png', 'jpg']) { const f = path.join(folder(id), `${dasar}.${ext}`); if (fs.existsSync(f)) return f; }
  return null;
}
function hapusGambar(id, dasar) {
  for (const ext of ['png', 'jpg']) { try { fs.unlinkSync(path.join(folder(id), `${dasar}.${ext}`)); } catch (e) {} }
}

// Daftar template untuk satu couple, lengkap dengan gambarnya (sebagai data URL)
function daftarTemplate(coupleId) {
  let ids = [];
  try { ids = fs.readdirSync(templatesDir); } catch (e) { return []; }
  const out = [];
  for (const id of ids) {
    const t = readJSON(path.join(folder(id), 'template.json'), null);
    if (!t || (coupleId && t.coupleId !== coupleId)) continue;
    const latar = cariGambar(id, 'latar'), bingkai = cariGambar(id, 'bingkai');
    out.push({ ...t, latarUrl: latar && dataUrl(latar), bingkaiUrl: bingkai && dataUrl(bingkai) });
  }
  return out.sort((a, b) => (a.dibuat || 0) - (b.dibuat || 0));
}

// Jumlah template setiap couple (tanpa memuat gambar), untuk daftar couple di Admin
function hitungTemplate() {
  const n = {};
  let ids = [];
  try { ids = fs.readdirSync(templatesDir); } catch (e) { return n; }
  for (const id of ids) {
    const t = readJSON(path.join(folder(id), 'template.json'), null);
    if (t && t.coupleId) n[t.coupleId] = (n[t.coupleId] || 0) + 1;
  }
  return n;
}
// Dipanggil saat couple dihapus supaya templatenya tidak tertinggal
function hapusTemplateCouple(coupleId) {
  if (!coupleId) return 0;
  let ids = [], n = 0;
  try { ids = fs.readdirSync(templatesDir); } catch (e) { return 0; }
  for (const id of ids) {
    const t = readJSON(path.join(folder(id), 'template.json'), null);
    if (t && t.coupleId === coupleId) {
      try { fs.rmSync(folder(id), { recursive: true, force: true }); n++; } catch (e) {}
    }
  }
  return n;
}

function daftarkan() {
  ipcMain.handle('template-ukuran', () => UKURAN);
  ipcMain.handle('count-templates', () => hitungTemplate());
  ipcMain.handle('list-templates', (e, coupleId) => daftarTemplate(coupleId));

  // gambar: { latar, bingkai } — masing-masing Uint8Array (ganti), null (hapus), atau tidak ada (biarkan)
  ipcMain.handle('save-template', (e, input, gambar = {}) => {
    try {
      if (!input || !input.coupleId) return { error: 'Couple belum dipilih.' };
      const t = bersihkan(input);
      const lama = readJSON(path.join(folder(t.id), 'template.json'), null);
      t.dibuat = (lama && lama.dibuat) || Date.now();
      t.diubah = Date.now();
      fs.mkdirSync(folder(t.id), { recursive: true });
      for (const dasar of ['latar', 'bingkai']) {
        if (!(dasar in gambar)) continue;
        hapusGambar(t.id, dasar);
        if (gambar[dasar] === null) continue;
        const bytes = Buffer.from(gambar[dasar]);
        if (bytes.length > MAX_GAMBAR) return { error: 'Gambar terlalu besar (maksimal 25 MB).' };
        const ext = ekstensi(bytes);
        if (!ext) return { error: 'Gambar harus berformat PNG atau JPG.' };
        if (dasar === 'bingkai' && ext !== 'png') return { error: 'Bingkai harus PNG supaya bagian fotonya bisa transparan.' };
        fs.writeFileSync(path.join(folder(t.id), `${dasar}.${ext}`), bytes);
      }
      writeJSON(path.join(folder(t.id), 'template.json'), t);
      return { ok: true, template: daftarTemplate(t.coupleId).find(x => x.id === t.id) };
    } catch (err) {
      console.log('Gagal menyimpan template: ' + err.message);
      return { error: err.message };
    }
  });

  ipcMain.handle('delete-template', (e, id) => {
    const bersih = String(id || '').replace(/[^a-z0-9_-]/gi, '');
    if (!bersih) return { error: 'Template tidak ditemukan.' };
    try { fs.rmSync(folder(bersih), { recursive: true, force: true }); return { ok: true }; }
    catch (err) { return { error: err.message }; }
  });
}

module.exports = { daftarkan, daftarTemplate, bersihkan, hitungTemplate, hapusTemplateCouple, UKURAN };
