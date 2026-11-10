/* =====================================================================
   qr.js — pembuat kode QR tanpa internet & tanpa pustaka luar.
   Mengikuti standar QR (ISO/IEC 18004): mode byte (UTF-8), koreksi
   kesalahan tingkat M (±15% kerusakan masih terbaca), versi 1–10
   (cukup untuk link sampai ±210 huruf).
   buatQR(teks) → { ukuran, gelap(x, y) }   gambarQR(canvas, teks, px)
   ===================================================================== */
(function () {
  // Tingkat M: jumlah kode koreksi per blok & jumlah blok, versi 1–10
  const ECC_PER_BLOK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const JUMLAH_BLOK = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

  const modulMentah = v => {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  };
  const kodeData = v => Math.floor(modulMentah(v) / 8) - ECC_PER_BLOK[v] * JUMLAH_BLOK[v];

  // Aritmetika GF(256) dengan polinomial 0x11D (Reed–Solomon)
  function kali(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }
  function pembagi(derajat) {
    const r = new Array(derajat).fill(0);
    r[derajat - 1] = 1;
    let akar = 1;
    for (let i = 0; i < derajat; i++) {
      for (let j = 0; j < r.length; j++) {
        r[j] = kali(r[j], akar);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      akar = kali(akar, 0x02);
    }
    return r;
  }
  function sisa(data, div) {
    const r = div.map(() => 0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      div.forEach((c, i) => {
        r[i] ^= kali(c, f);
      });
    }
    return r;
  }

  function buatQR(teks) {
    const byte = Array.from(new TextEncoder().encode(String(teks)));
    let v = 1;
    for (; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + byte.length * 8 <= kodeData(v) * 8) break;
    if (v > 10) throw new Error('Teks terlalu panjang untuk kode QR');

    // Susun bit data: mode byte (0100), panjang, isi, penutup, isian
    const bit = [];
    const tambah = (nilai, n) => {
      for (let i = n - 1; i >= 0; i--) bit.push((nilai >>> i) & 1);
    };
    tambah(4, 4);
    tambah(byte.length, v < 10 ? 8 : 16);
    byte.forEach(b => tambah(b, 8));
    const kapasitas = kodeData(v) * 8;
    tambah(0, Math.min(4, kapasitas - bit.length));
    tambah(0, (8 - (bit.length % 8)) % 8);
    for (let isi = 0xec; bit.length < kapasitas; isi ^= 0xec ^ 0x11) tambah(isi, 8);
    const data = [];
    for (let i = 0; i < bit.length; i += 8) data.push(bit.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

    // Bagi per blok, tambahkan kode koreksi, lalu jalin (interleave)
    const nBlok = JUMLAH_BLOK[v],
      nEcc = ECC_PER_BLOK[v],
      mentah = Math.floor(modulMentah(v) / 8);
    const nPendek = nBlok - (mentah % nBlok),
      panjangPendek = Math.floor(mentah / nBlok);
    const div = pembagi(nEcc),
      blok = [];
    for (let i = 0, k = 0; i < nBlok; i++) {
      const d = data.slice(k, k + panjangPendek - nEcc + (i < nPendek ? 0 : 1));
      k += d.length;
      const b = d.concat(sisa(d, div));
      if (i < nPendek) b.splice(d.length, 0, null);
      blok.push(b);
    }
    const kode = [];
    for (let i = 0; i < blok[0].length; i++)
      blok.forEach((b, j) => {
        if (i !== panjangPendek - nEcc || j >= nPendek) kode.push(b[i]);
      });

    // Gambar pola tetap
    const n = v * 4 + 17;
    const m = Array.from({ length: n }, () => new Array(n).fill(false));
    const tetap = Array.from({ length: n }, () => new Array(n).fill(false));
    const set = (x, y, g) => {
      m[y][x] = g;
      tetap[y][x] = true;
    };
    for (let i = 0; i < n; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    const pencari = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy)),
            x = cx + dx,
            y = cy + dy;
          if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4);
        }
    };
    pencari(3, 3);
    pencari(n - 4, 3);
    pencari(3, n - 4);
    if (v >= 2) {
      const nA = Math.floor(v / 7) + 2,
        langkah = Math.ceil((v * 4 + 4) / (nA * 2 - 2)) * 2,
        pos = [6];
      for (let p = n - 7; pos.length < nA; p -= langkah) pos.splice(1, 0, p);
      pos.forEach((x, i) =>
        pos.forEach((y, j) => {
          if ((i === 0 && j === 0) || (i === 0 && j === nA - 1) || (i === nA - 1 && j === 0)) return;
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }),
      );
    }
    const formatBit = mask => {
      const d = (0 << 3) | mask; // tingkat M = 00
      let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      return ((d << 10) | r) ^ 0x5412;
    };
    const pasangFormat = mask => {
      const b = formatBit(mask),
        g = i => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) set(8, i, g(i));
      set(8, 7, g(6));
      set(8, 8, g(7));
      set(7, 8, g(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
      for (let i = 0; i < 8; i++) set(n - 1 - i, 8, g(i));
      for (let i = 8; i < 15; i++) set(8, n - 15 + i, g(i));
      set(8, n - 8, true);
    };
    pasangFormat(0);
    if (v >= 7) {
      let r = v;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const b = (v << 12) | r;
      for (let i = 0; i < 18; i++) {
        const g = ((b >>> i) & 1) !== 0,
          a = n - 11 + (i % 3),
          c = Math.floor(i / 3);
        set(a, c, g);
        set(c, a, g);
      }
    }

    // Letakkan data berzigzag dari kanan bawah
    let i = 0;
    for (let kanan = n - 1; kanan >= 1; kanan -= 2) {
      if (kanan === 6) kanan = 5;
      for (let t = 0; t < n; t++)
        for (let j = 0; j < 2; j++) {
          const x = kanan - j,
            naik = ((kanan + 1) & 2) === 0,
            y = naik ? n - 1 - t : t;
          if (!tetap[y][x] && i < kode.length * 8) {
            m[y][x] = ((kode[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
    }

    // Pilih pola mask dengan nilai "penalti" terkecil (paling mudah dibaca)
    const RUMUS = [
      (x, y) => (x + y) % 2,
      (x, y) => y % 2,
      x => x % 3,
      (x, y) => (x + y) % 3,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2,
      (x, y) => ((x * y) % 2) + ((x * y) % 3),
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2,
    ];
    const pakaiMask = k => {
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) if (!tetap[y][x] && RUMUS[k](x, y) === 0) m[y][x] = !m[y][x];
    };
    function penalti() {
      let p = 0,
        gelap = 0;
      const garis = baca => {
        let run = 1;
        for (let k = 1; k <= n; k++) {
          if (k < n && baca(k) === baca(k - 1)) run++;
          else {
            if (run >= 5) p += run - 2;
            run = 1;
          }
        }
        for (let k = 0; k + 10 < n; k++) {
          // pola mirip penanda 1:1:3:1:1 dengan ruang putih
          const s = Array.from({ length: 11 }, (_, q) => (baca(k + q) ? 1 : 0)).join('');
          if (s === '10111010000' || s === '00001011101') p += 40;
        }
      };
      for (let y = 0; y < n; y++) garis(x => m[y][x]);
      for (let x = 0; x < n; x++) garis(y => m[y][x]);
      for (let y = 0; y < n - 1; y++)
        for (let x = 0; x < n - 1; x++) {
          const c = m[y][x];
          if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
        }
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) gelap++;
      p += Math.floor(Math.abs(gelap * 20 - n * n * 10) / (n * n)) * 10;
      return p;
    }
    let terbaik = 0,
      nilai = Infinity;
    for (let k = 0; k < 8; k++) {
      pakaiMask(k);
      pasangFormat(k);
      const pn = penalti();
      if (pn < nilai) {
        nilai = pn;
        terbaik = k;
      }
      pakaiMask(k); // kembalikan (mask XOR dua kali = semula)
    }
    pakaiMask(terbaik);
    pasangFormat(terbaik);
    return { ukuran: n, versi: v, mask: terbaik, gelap: (x, y) => m[y][x] };
  }

  // Gambar QR ke canvas, dengan tepi putih 4 modul (wajib menurut standar)
  function gambarQR(canvas, teks, px = 8) {
    const q = buatQR(teks),
      tepi = 4,
      s = (q.ukuran + tepi * 2) * px;
    canvas.width = s;
    canvas.height = s;
    const c = canvas.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, s, s);
    c.fillStyle = '#000';
    for (let y = 0; y < q.ukuran; y++)
      for (let x = 0; x < q.ukuran; x++) if (q.gelap(x, y)) c.fillRect((x + tepi) * px, (y + tepi) * px, px, px);
    return q;
  }

  if (typeof module !== 'undefined') module.exports = { buatQR };
  else {
    window.buatQR = buatQR;
    window.gambarQR = gambarQR;
  }
})();
