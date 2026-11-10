/* =====================================================================
   lut.js — filter foto dari file LUT 3D (.cube)
   File .cube adalah "resep warna" yang bisa diekspor dari Lightroom/Photoshop
   (Export Color Lookup Tables), DaVinci Resolve, atau dibeli sebagai preset.
   - bacaCube(teks)            → { size, data, judul, ... } atau Error (pesan bahasa Inggris)
   - terapkanLut(foto, lut, k) → kanvas baru berisi foto yang sudah difilter
                                  (k = kekuatan 0..1; foto besar diperkecil dulu)
   Dipakai di tampilan (photobooth, editor template) dan di proses utama
   (main/filter.js memakai bacaCube untuk memeriksa file yang diunggah).
   ===================================================================== */

const LUT_UKURAN_MAKS = 65; // 65×65×65 titik warna (ukuran .cube terbesar yang umum)

function bacaCube(teks) {
  const baris = String(teks || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);
  let size = 0,
    judul = '';
  let min = [0, 0, 0],
    max = [1, 1, 1];
  let data = null,
    n = 0;
  for (let i = 0; i < baris.length; i++) {
    const b = baris[i].trim();
    if (!b || b[0] === '#') continue;
    const kata = b.split(/\s+/);
    const kunci = kata[0].toUpperCase();
    if (kunci === 'TITLE') {
      judul = b.slice(5).trim().replace(/^"|"$/g, '').slice(0, 60);
      continue;
    }
    if (kunci === 'LUT_1D_SIZE') throw new Error('This filter is a 1D LUT. Export it again as a 3D LUT (.cube).');
    if (kunci === 'LUT_3D_SIZE') {
      size = Number(kata[1]);
      if (!Number.isInteger(size) || size < 2 || size > LUT_UKURAN_MAKS)
        throw new Error(`Unsupported LUT size (${kata[1]}). Use a size from 2 to ${LUT_UKURAN_MAKS}.`);
      data = new Float32Array(size * size * size * 3);
      continue;
    }
    if (kunci === 'DOMAIN_MIN' || kunci === 'DOMAIN_MAX') {
      const v = kata.slice(1, 4).map(Number);
      if (v.length !== 3 || v.some(x => !Number.isFinite(x))) throw new Error(`Line ${i + 1} is not valid: ${kunci}.`);
      if (kunci === 'DOMAIN_MIN') min = v;
      else max = v;
      continue;
    }
    if (kunci === 'LUT_3D_INPUT_RANGE') {
      const lo = Number(kata[1]),
        hi = Number(kata[2]);
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        min = [lo, lo, lo];
        max = [hi, hi, hi];
      }
      continue;
    }
    if (/^[A-Z_]+$/.test(kunci)) continue; // kata kunci lain yang tidak dipakai
    if (!data) throw new Error('The .cube file has no LUT_3D_SIZE line before the color data.');
    if (kata.length < 3) throw new Error(`Line ${i + 1} doesn't contain 3 color values.`);
    if (n >= data.length) throw new Error('There is more color data than the LUT size allows.');
    for (let c = 0; c < 3; c++) {
      const v = Number(kata[c]);
      if (!Number.isFinite(v)) throw new Error(`Line ${i + 1} contains an invalid number.`);
      data[n++] = v;
    }
  }
  if (!data) throw new Error('This is not a .cube LUT file (no LUT_3D_SIZE).');
  if (n !== data.length) throw new Error(`Missing color data: found ${n / 3}, expected ${data.length / 3}.`);
  for (let c = 0; c < 3; c++) if (!(max[c] > min[c])) throw new Error('DOMAIN_MIN must be smaller than DOMAIN_MAX.');
  // Simpan sebagai 0..255 supaya penerapan per piksel cepat
  for (let i = 0; i < data.length; i++) data[i] = Math.min(255, Math.max(0, data[i] * 255));
  return { size, data, judul, min, max };
}

// Terapkan LUT ke data piksel RGBA (di tempat). k = kekuatan 0..1.
function terapkanLutPiksel(px, lut, k = 1) {
  const N = lut.size,
    D = lut.data,
    N2 = N * N,
    akhir = N - 1;
  // nilai 0..255 → posisi 0..N-1 (memperhitungkan DOMAIN_MIN/MAX)
  const sk = [0, 1, 2].map(c => akhir / (255 * (lut.max[c] - lut.min[c])));
  const of = [0, 1, 2].map(c => (-lut.min[c] * akhir) / (lut.max[c] - lut.min[c]));
  const kk = Math.min(1, Math.max(0, k)),
    asli = 1 - kk;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i] * sk[0] + of[0],
      g = px[i + 1] * sk[1] + of[1],
      b = px[i + 2] * sk[2] + of[2];
    r = r < 0 ? 0 : r > akhir ? akhir : r;
    g = g < 0 ? 0 : g > akhir ? akhir : g;
    b = b < 0 ? 0 : b > akhir ? akhir : b;
    const r0 = r | 0,
      g0 = g | 0,
      b0 = b | 0;
    const r1 = r0 < akhir ? r0 + 1 : r0,
      g1 = g0 < akhir ? g0 + 1 : g0,
      b1 = b0 < akhir ? b0 + 1 : b0;
    const fr = r - r0,
      fg = g - g0,
      fb = b - b0;
    // urutan .cube: merah berubah paling cepat
    const i000 = (r0 + g0 * N + b0 * N2) * 3,
      i100 = (r1 + g0 * N + b0 * N2) * 3;
    const i010 = (r0 + g1 * N + b0 * N2) * 3,
      i110 = (r1 + g1 * N + b0 * N2) * 3;
    const i001 = (r0 + g0 * N + b1 * N2) * 3,
      i101 = (r1 + g0 * N + b1 * N2) * 3;
    const i011 = (r0 + g1 * N + b1 * N2) * 3,
      i111 = (r1 + g1 * N + b1 * N2) * 3;
    for (let c = 0; c < 3; c++) {
      const c00 = D[i000 + c] + (D[i100 + c] - D[i000 + c]) * fr;
      const c10 = D[i010 + c] + (D[i110 + c] - D[i010 + c]) * fr;
      const c01 = D[i001 + c] + (D[i101 + c] - D[i001 + c]) * fr;
      const c11 = D[i011 + c] + (D[i111 + c] - D[i011 + c]) * fr;
      const c0 = c00 + (c10 - c00) * fg,
        c1 = c01 + (c11 - c01) * fg;
      const v = c0 + (c1 - c0) * fb;
      px[i + c] = kk === 1 ? v : px[i + c] * asli + v * kk;
    }
  }
  return px;
}

// Foto (kanvas/gambar) → kanvas baru yang sudah difilter.
// sisiMaks: foto yang lebih besar diperkecil dulu (hasil cetak 1800 piksel sudah cukup, dan jauh lebih cepat).
function terapkanLut(foto, lut, k = 1, sisiMaks = 1800) {
  const w0 = foto.naturalWidth || foto.videoWidth || foto.width,
    h0 = foto.naturalHeight || foto.videoHeight || foto.height;
  const s = Math.min(1, sisiMaks / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * s));
  c.height = Math.max(1, Math.round(h0 * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(foto, 0, 0, c.width, c.height);
  if (!lut || k <= 0) return c;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  terapkanLutPiksel(img.data, lut, k);
  ctx.putImageData(img, 0, 0);
  return c;
}

// Foto contoh untuk pratinjau filter di Admin (langit, kulit, warna dasar, abu-abu)
function fotoContohFilter() {
  if (fotoContohFilter.c) return fotoContohFilter.c;
  const c = document.createElement('canvas');
  c.width = 600;
  c.height = 400;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 260);
  g.addColorStop(0, '#7FB2E5');
  g.addColorStop(1, '#F2D4B7');
  x.fillStyle = g;
  x.fillRect(0, 0, 600, 400);
  x.fillStyle = '#5E7F4E';
  x.fillRect(0, 260, 600, 140);
  x.fillStyle = '#E0B494';
  x.beginPath();
  x.ellipse(300, 210, 70, 88, 0, 0, Math.PI * 2);
  x.fill(); // wajah
  x.fillStyle = '#3B2A22';
  x.beginPath();
  x.ellipse(300, 150, 76, 48, 0, Math.PI, Math.PI * 2);
  x.fill(); // rambut
  x.fillStyle = '#F4F1EC';
  x.fillRect(215, 300, 170, 100); // baju putih
  ['#D9433B', '#F2B33D', '#3FA35B', '#2F6FD6'].forEach((w, i) => {
    x.fillStyle = w;
    x.fillRect(20 + i * 42, 330, 34, 50);
  });
  for (let i = 0; i < 6; i++) {
    const v = Math.round(i * 51);
    x.fillStyle = `rgb(${v},${v},${v})`;
    x.fillRect(430 + i * 26, 330, 26, 50);
  }
  fotoContohFilter.c = c;
  return c;
}

// Ambil & urai filter dari koleksi Admin (sekali per filter, lalu disimpan sementara)
const cacheLutTampilan = new Map();
function muatLut(id) {
  if (!id || typeof window === 'undefined' || !window.api || !window.api.filterIsi) return Promise.resolve(null);
  if (!cacheLutTampilan.has(id)) {
    cacheLutTampilan.set(
      id,
      window.api
        .filterIsi(id)
        .then(r => (r ? { id, nama: r.nama, lut: bacaCube(r.teks) } : null))
        .catch(e => {
          console.log('Filter tidak bisa dimuat: ' + (e && e.message));
          return null;
        }),
    );
  }
  return cacheLutTampilan.get(id);
}
const lupakanLut = id => cacheLutTampilan.delete(id);

if (typeof module !== 'undefined' && module.exports) module.exports = { bacaCube, terapkanLutPiksel, LUT_UKURAN_MAKS };
