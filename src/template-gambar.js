/* =====================================================================
   template-gambar.js — menggambar template desain foto.
   Dipakai editor template (Admin) dan halaman Edit foto (tamu), jadi
   yang dilihat admin di editor sama persis dengan hasil foto tamu.
   Urutan lapisan: warna latar → gambar latar → foto 1-4 → bingkai PNG → teks
   ===================================================================== */

const FONT_TEMPLATE = {
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  script: '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive',
};
const NAMA_FONT = { sans: 'Modern', serif: 'Klasik', script: 'Tulisan tangan' };

// {couple} dan {tanggal} diganti otomatis saat foto dibuat
function isiTeksTemplate(teks) {
  const tanggal = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  return String(teks || '')
    .replace(/\{couple\}/gi, activeCouple ? activeCouple.name : '')
    .replace(/\{tanggal\}/gi, tanggal);
}
const fontTeks = t => `${t.bold ? 700 : 400} ${t.size}px ${FONT_TEMPLATE[t.font] || FONT_TEMPLATE.sans}`;

// Gambar mengisi kotak tanpa gepeng (dipotong di tengah)
function gambarCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}
function muatGambar(src) {
  return new Promise(res => {
    if (!src) return res(null);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

// Siapkan template: muat gambar latar & bingkai sekali, lalu disimpan sementara
const cacheTemplate = new Map();
async function siapkanTemplate(tpl) {
  const kunci = tpl.id + ':' + (tpl.diubah || 0);
  if (cacheTemplate.has(kunci)) return cacheTemplate.get(kunci);
  const siap = { tpl, latar: await muatGambar(tpl.latarUrl), bingkai: await muatGambar(tpl.bingkaiUrl) };
  cacheTemplate.set(kunci, siap);
  return siap;
}

/* Gambar satu template.
   opsi.photos      kanvas foto 1-4 (kosong = tidak digambar)
   opsi.filter      filter CSS untuk foto
   opsi.placeholder true = kotak foto kosong digambar abu-abu bernomor (untuk editor) */
function gambarTemplate(ctx, siap, opsi = {}) {
  const { tpl, latar, bingkai } = siap;
  const { scale = 1, photos = [], filter = 'none', placeholder = false } = opsi;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = tpl.latarWarna || '#FFFFFF';
  ctx.fillRect(0, 0, tpl.W, tpl.H);
  if (latar) gambarCover(ctx, latar, 0, 0, tpl.W, tpl.H);

  tpl.slots.forEach((s, i) => {
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(s.x, s.y, s.w, s.h, s.r || 0); else ctx.rect(s.x, s.y, s.w, s.h);
    ctx.clip();
    if (photos[i]) {
      ctx.filter = filter;
      gambarCover(ctx, photos[i], s.x, s.y, s.w, s.h);
    } else if (placeholder) {
      ctx.fillStyle = 'rgba(120,120,128,.35)';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.font = `700 ${Math.max(24, Math.min(s.w, s.h) * 0.35)}px ${FONT_TEMPLATE.sans}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), s.x + s.w / 2, s.y + s.h / 2);
    }
    ctx.restore();
  });

  if (bingkai) ctx.drawImage(bingkai, 0, 0, tpl.W, tpl.H);

  for (const t of tpl.texts) {
    const isi = isiTeksTemplate(t.text);
    if (!isi) continue;
    ctx.font = fontTeks(t);
    ctx.fillStyle = t.color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(isi, t.x, t.y);
  }
  ctx.restore();
}

// Lebar teks (dalam satuan template) untuk kotak pilihan di editor
function lebarTeks(t) {
  const c = lebarTeks.c || (lebarTeks.c = document.createElement('canvas').getContext('2d'));
  c.font = fontTeks(t);
  return c.measureText(isiTeksTemplate(t.text) || ' ').width;
}

/* Susunan cepat posisi foto 1-4, menyesuaikan ukuran template.
   Bagian bawah dikosongkan untuk teks (nama couple & tanggal). */
function susunanFoto(jenis, W, H) {
  const m = Math.round(Math.min(W, H) * 0.05), g = Math.round(Math.min(W, H) * 0.025);
  const datar = W > H;
  const x0 = m, y0 = m, aw = W - 2 * m, ah = Math.round(H * (datar ? 0.80 : 0.84)) - m;
  const r = 8, k = [];
  if (jenis === 'kisi') {
    const w = (aw - g) / 2, h = (ah - g) / 2;
    for (let i = 0; i < 4; i++) k.push({ x: x0 + (i % 2) * (w + g), y: y0 + Math.floor(i / 2) * (h + g), w, h, r });
  } else if (jenis === 'kolom') {
    const h = (ah - 3 * g) / 4;
    for (let i = 0; i < 4; i++) k.push({ x: x0, y: y0 + i * (h + g), w: aw, h, r });
  } else if (jenis === 'baris') {
    const w = (aw - 3 * g) / 4;
    for (let i = 0; i < 4; i++) k.push({ x: x0 + i * (w + g), y: y0, w, h: ah, r });
  } else {                                   // 'besar': 1 besar di atas, 3 kecil di bawah
    const bh = (ah - g) * 0.62, sh = ah - g - bh, sw = (aw - 2 * g) / 3;
    k.push({ x: x0, y: y0, w: aw, h: bh, r });
    for (let i = 0; i < 3; i++) k.push({ x: x0 + i * (sw + g), y: y0 + bh + g, w: sw, h: sh, r });
  }
  return k.map(s => ({ x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.w), h: Math.round(s.h), r: s.r }));
}
function teksBawaan(W, H) {
  const datar = W > H, s = Math.min(W, H);
  return [
    { id: 't1', text: '{couple}', x: W / 2, y: Math.round(H * (datar ? 0.88 : 0.905)), size: Math.round(s * (W < 700 ? 0.085 : 0.07)), color: '#1D1D1F', font: 'script', bold: false },
    { id: 't2', text: '{tanggal}', x: W / 2, y: Math.round(H * (datar ? 0.95 : 0.96)), size: Math.round(s * 0.03), color: '#6E6E73', font: 'sans', bold: false },
  ];
}
