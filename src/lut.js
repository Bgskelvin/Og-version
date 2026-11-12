/* =====================================================================
   lut.js — photo filters from 3D LUT files (.cube)
   A .cube file is a "color recipe" that can be exported from Lightroom/Photoshop
   (Export Color Lookup Tables), DaVinci Resolve, or bought as a preset.
   - parseCube(text)              → { size, data, title, min, max } or throws (English message)
   - applyLut(photo, lut, k)      → new canvas with the filtered photo
                                    (k = strength 0..1; large photos are scaled down first)
   Used by the UI (photo booth, template editor) and by the main process
   (main/filter.js uses parseCube to check uploaded files).
   ===================================================================== */

export const LUT_MAX_SIZE = 65; // 65×65×65 color points (the largest common .cube size)

export function parseCube(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);
  let size = 0,
    title = '';
  let min = [0, 0, 0],
    max = [1, 1, 1];
  let data = null,
    n = 0;
  for (let i = 0; i < lines.length; i++) {
    const b = lines[i].trim();
    if (!b || b[0] === '#') continue;
    const words = b.split(/\s+/);
    const keyword = words[0].toUpperCase();
    if (keyword === 'TITLE') {
      title = b.slice(5).trim().replace(/^"|"$/g, '').slice(0, 60);
      continue;
    }
    if (keyword === 'LUT_1D_SIZE') throw new Error('This filter is a 1D LUT. Export it again as a 3D LUT (.cube).');
    if (keyword === 'LUT_3D_SIZE') {
      size = Number(words[1]);
      if (!Number.isInteger(size) || size < 2 || size > LUT_MAX_SIZE)
        throw new Error(`Unsupported LUT size (${words[1]}). Use a size from 2 to ${LUT_MAX_SIZE}.`);
      data = new Float32Array(size * size * size * 3);
      continue;
    }
    if (keyword === 'DOMAIN_MIN' || keyword === 'DOMAIN_MAX') {
      const v = words.slice(1, 4).map(Number);
      if (v.length !== 3 || v.some(x => !Number.isFinite(x)))
        throw new Error(`Line ${i + 1} is not valid: ${keyword}.`);
      if (keyword === 'DOMAIN_MIN') min = v;
      else max = v;
      continue;
    }
    if (keyword === 'LUT_3D_INPUT_RANGE') {
      const lo = Number(words[1]),
        hi = Number(words[2]);
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        min = [lo, lo, lo];
        max = [hi, hi, hi];
      }
      continue;
    }
    if (/^[A-Z_]+$/.test(keyword)) continue; // other keywords we don't use
    if (!data) throw new Error('The .cube file has no LUT_3D_SIZE line before the color data.');
    if (words.length < 3) throw new Error(`Line ${i + 1} doesn't contain 3 color values.`);
    if (n >= data.length) throw new Error('There is more color data than the LUT size allows.');
    for (let c = 0; c < 3; c++) {
      const v = Number(words[c]);
      if (!Number.isFinite(v)) throw new Error(`Line ${i + 1} contains an invalid number.`);
      data[n++] = v;
    }
  }
  if (!data) throw new Error('This is not a .cube LUT file (no LUT_3D_SIZE).');
  if (n !== data.length) throw new Error(`Missing color data: found ${n / 3}, expected ${data.length / 3}.`);
  for (let c = 0; c < 3; c++) if (!(max[c] > min[c])) throw new Error('DOMAIN_MIN must be smaller than DOMAIN_MAX.');
  // Store as 0..255 so applying per pixel is fast
  for (let i = 0; i < data.length; i++) data[i] = Math.min(255, Math.max(0, data[i] * 255));
  return { size, data, title, min, max };
}

// Apply a LUT to RGBA pixel data (in place). k = strength 0..1.
export function applyLutPixels(px, lut, k = 1) {
  const N = lut.size,
    D = lut.data,
    N2 = N * N,
    last = N - 1;
  // value 0..255 → position 0..N-1 (taking DOMAIN_MIN/MAX into account)
  const scale = [0, 1, 2].map(c => last / (255 * (lut.max[c] - lut.min[c])));
  const offset = [0, 1, 2].map(c => (-lut.min[c] * last) / (lut.max[c] - lut.min[c]));
  const kk = Math.min(1, Math.max(0, k)),
    original = 1 - kk;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i] * scale[0] + offset[0],
      g = px[i + 1] * scale[1] + offset[1],
      b = px[i + 2] * scale[2] + offset[2];
    r = r < 0 ? 0 : r > last ? last : r;
    g = g < 0 ? 0 : g > last ? last : g;
    b = b < 0 ? 0 : b > last ? last : b;
    const r0 = r | 0,
      g0 = g | 0,
      b0 = b | 0;
    const r1 = r0 < last ? r0 + 1 : r0,
      g1 = g0 < last ? g0 + 1 : g0,
      b1 = b0 < last ? b0 + 1 : b0;
    const fr = r - r0,
      fg = g - g0,
      fb = b - b0;
    // .cube order: red changes fastest
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
      px[i + c] = kk === 1 ? v : px[i + c] * original + v * kk;
    }
  }
  return px;
}

// Photo (canvas/image) → new canvas with the filter applied.
// maxSide: larger photos are scaled down first (1800 px is enough for prints, and much faster).
export function applyLut(photo, lut, k = 1, maxSide = 1800) {
  const w0 = photo.naturalWidth || photo.videoWidth || photo.width,
    h0 = photo.naturalHeight || photo.videoHeight || photo.height;
  const s = Math.min(1, maxSide / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * s));
  c.height = Math.max(1, Math.round(h0 * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(photo, 0, 0, c.width, c.height);
  if (!lut || k <= 0) return c;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  applyLutPixels(img.data, lut, k);
  ctx.putImageData(img, 0, 0);
  return c;
}

// Sample photo for the filter preview in Admin (sky, skin, primary colors, grays)
let samplePhoto = null;
export function sampleFilterPhoto() {
  if (samplePhoto) return samplePhoto;
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
  x.fill(); // face
  x.fillStyle = '#3B2A22';
  x.beginPath();
  x.ellipse(300, 150, 76, 48, 0, Math.PI, Math.PI * 2);
  x.fill(); // hair
  x.fillStyle = '#F4F1EC';
  x.fillRect(215, 300, 170, 100); // white shirt
  ['#D9433B', '#F2B33D', '#3FA35B', '#2F6FD6'].forEach((color, i) => {
    x.fillStyle = color;
    x.fillRect(20 + i * 42, 330, 34, 50);
  });
  for (let i = 0; i < 6; i++) {
    const v = Math.round(i * 51);
    x.fillStyle = `rgb(${v},${v},${v})`;
    x.fillRect(430 + i * 26, 330, 26, 50);
  }
  samplePhoto = c;
  return c;
}

// Fetch & parse a filter from the Admin collection (once per filter, then cached)
const lutCache = new Map();
export function loadLut(id) {
  if (!id || typeof window === 'undefined' || !window.api || !window.api.getFilter) return Promise.resolve(null);
  if (!lutCache.has(id)) {
    lutCache.set(
      id,
      window.api
        .getFilter(id)
        .then(r => (r ? { id, name: r.name, lut: parseCube(r.text) } : null))
        .catch(e => {
          console.log('Filter could not be loaded: ' + (e && e.message));
          return null;
        }),
    );
  }
  return lutCache.get(id);
}
export const forgetLut = id => lutCache.delete(id);
