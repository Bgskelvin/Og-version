/* =====================================================================
   qr.js — offline QR code generator, no external libraries.
   Follows the QR standard (ISO/IEC 18004): byte mode (UTF-8), error
   correction level M (still readable with ±15% damage), versions 1–10
   (enough for links up to ±210 characters).
   createQr(text) → { size, version, mask, isDark(x, y) }
   drawQr(canvas, text, px) draws it onto a <canvas>.
   ===================================================================== */

// Level M: error-correction codewords per block & number of blocks, versions 1–10
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCK_COUNT = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

const rawModules = v => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (v >= 7) r -= 36;
  }
  return r;
};
const dataCodewords = v => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCK_COUNT[v];

// GF(256) arithmetic with polynomial 0x11D (Reed–Solomon)
function multiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function generatorPolynomial(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = multiply(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = multiply(root, 0x02);
  }
  return r;
}
function remainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => {
      r[i] ^= multiply(c, factor);
    });
  }
  return r;
}

export function createQr(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  let v = 1;
  for (; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8) break;
  if (v > 10) throw new Error('Text is too long for a QR code');

  // Build the data bits: byte mode (0100), length, content, terminator, padding
  const bits = [];
  const append = (value, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(4, 4);
  append(bytes.length, v < 10 ? 8 : 16);
  bytes.forEach(b => append(b, 8));
  const capacity = dataCodewords(v) * 8;
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Split into blocks, add error-correction codewords, then interleave
  const numBlocks = BLOCK_COUNT[v],
    numEcc = ECC_PER_BLOCK[v],
    raw = Math.floor(rawModules(v) / 8);
  const numShort = numBlocks - (raw % numBlocks),
    shortLength = Math.floor(raw / numBlocks);
  const divisor = generatorPolynomial(numEcc),
    blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const d = data.slice(k, k + shortLength - numEcc + (i < numShort ? 0 : 1));
    k += d.length;
    const b = d.concat(remainder(d, divisor));
    if (i < numShort) b.splice(d.length, 0, null);
    blocks.push(b);
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((b, j) => {
      if (i !== shortLength - numEcc || j >= numShort) codewords.push(b[i]);
    });

  // Draw the fixed patterns
  const n = v * 4 + 17;
  const m = Array.from({ length: n }, () => new Array(n).fill(false));
  const reserved = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (x, y, dark) => {
    m[y][x] = dark;
    reserved[y][x] = true;
  };
  for (let i = 0; i < n; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)),
          x = cx + dx,
          y = cy + dy;
        if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(n - 4, 3);
  finder(3, n - 4);
  if (v >= 2) {
    const numAlign = Math.floor(v / 7) + 2,
      step = Math.ceil((v * 4 + 4) / (numAlign * 2 - 2)) * 2,
      pos = [6];
    for (let p = n - 7; pos.length < numAlign; p -= step) pos.splice(1, 0, p);
    pos.forEach((x, i) =>
      pos.forEach((y, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === numAlign - 1) || (i === numAlign - 1 && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }),
    );
  }
  const formatBits = mask => {
    const d = (0 << 3) | mask; // level M = 00
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    return ((d << 10) | r) ^ 0x5412;
  };
  const placeFormat = mask => {
    const b = formatBits(mask),
      bit = i => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(i));
    set(8, n - 8, true);
  };
  placeFormat(0);
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const dark = ((b >>> i) & 1) !== 0,
        a = n - 11 + (i % 3),
        c = Math.floor(i / 3);
      set(a, c, dark);
      set(c, a, dark);
    }
  }

  // Place the data in a zigzag starting at the bottom right
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let t = 0; t < n; t++)
      for (let j = 0; j < 2; j++) {
        const x = right - j,
          upward = ((right + 1) & 2) === 0,
          y = upward ? n - 1 - t : t;
        if (!reserved[y][x] && i < codewords.length * 8) {
          m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
  }

  // Pick the mask pattern with the lowest "penalty" score (easiest to scan)
  const MASKS = [
    (x, y) => (x + y) % 2,
    (x, y) => y % 2,
    x => x % 3,
    (x, y) => (x + y) % 3,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2,
    (x, y) => ((x * y) % 2) + ((x * y) % 3),
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2,
  ];
  const applyMask = k => {
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) if (!reserved[y][x] && MASKS[k](x, y) === 0) m[y][x] = !m[y][x];
  };
  function penalty() {
    let p = 0,
      dark = 0;
    const line = read => {
      let run = 1;
      for (let k = 1; k <= n; k++) {
        if (k < n && read(k) === read(k - 1)) run++;
        else {
          if (run >= 5) p += run - 2;
          run = 1;
        }
      }
      for (let k = 0; k + 10 < n; k++) {
        // finder-like 1:1:3:1:1 pattern next to white space
        const s = Array.from({ length: 11 }, (_, q) => (read(k + q) ? 1 : 0)).join('');
        if (s === '10111010000' || s === '00001011101') p += 40;
      }
    };
    for (let y = 0; y < n; y++) line(x => m[y][x]);
    for (let x = 0; x < n; x++) line(y => m[y][x]);
    for (let y = 0; y < n - 1; y++)
      for (let x = 0; x < n - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
      }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) dark++;
    p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
    return p;
  }
  let best = 0,
    bestScore = Infinity;
  for (let k = 0; k < 8; k++) {
    applyMask(k);
    placeFormat(k);
    const score = penalty();
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
    applyMask(k); // undo (applying a mask twice restores the original)
  }
  applyMask(best);
  placeFormat(best);
  return { size: n, version: v, mask: best, isDark: (x, y) => m[y][x] };
}

// Draw the QR onto a canvas, with a 4-module white quiet zone (required by the standard)
export function drawQr(canvas, text, px = 8) {
  const qr = createQr(text),
    quietZone = 4,
    side = (qr.size + quietZone * 2) * px;
  canvas.width = side;
  canvas.height = side;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, side, side);
  c.fillStyle = '#000';
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++)
      if (qr.isDark(x, y)) c.fillRect((x + quietZone) * px, (y + quietZone) * px, px, px);
  return qr;
}
