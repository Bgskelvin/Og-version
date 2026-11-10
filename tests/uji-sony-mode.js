/* =====================================================================
   uji-sony-mode.js — bisakah aplikasi mengganti mode FOTO ↔ VIDEO kamera
   Sony tanpa memutar tombol di kamera? (uji dengan kamera ASLI)
   Jalankan:   npm run uji:sony-mode
   Butuh program penghubung terbaru:  npm run build:sony  (sekali)

   Mengecek: mode sekarang, bisa diubah dari komputer atau tidak,
   pindah ke video → ukuran live view, pindah ke foto → ukuran live view,
   lalu mengembalikan kamera ke mode semula.
   Hasil: kamera-sony/hasil-uji/laporan-mode.txt
   ===================================================================== */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { jelaskanSambung } = require('../main/pesan-sony');

const AKAR = path.join(__dirname, '..');
const HELPER = process.env.SONY_HELPER || path.join(AKAR, 'kamera-sony', 'bin', 'sony-helper');
const HASIL = path.join(AKAR, 'kamera-sony', 'hasil-uji');
const laporan = [];
const tulis = t => {
  console.log(t);
  laporan.push(t);
};
const jeda = ms => new Promise(r => setTimeout(r, ms));

if (!fs.existsSync(HELPER)) {
  console.log('\n✗ Program kamera Sony belum dibuat. Jalankan dulu:  npm run build:sony\n');
  process.exit(1);
}
fs.mkdirSync(HASIL, { recursive: true });

const p = spawn(HELPER, [], { cwd: path.dirname(HELPER) });
let seq = 0,
  selesai = false;
const tunggu = new Map();
readline.createInterface({ input: p.stdout }).on('line', l => {
  if (!l.startsWith('{')) return;
  let m;
  try {
    m = JSON.parse(l);
  } catch {
    return;
  }
  if (m.ev) return;
  const t = tunggu.get(m.id);
  if (t) {
    tunggu.delete(m.id);
    t(m);
  }
});
p.on('exit', c => {
  if (!selesai) {
    tulis(`\n✗ Program kamera berhenti mendadak (kode ${c}).`);
    simpan();
    process.exit(1);
  }
});
const kirim = (cmd, ...args) =>
  new Promise(r => {
    const id = ++seq;
    const batas = setTimeout(() => {
      tunggu.delete(id);
      r({ ok: false, error: 'tidak ada jawaban (' + cmd + ')' });
    }, 30000);
    tunggu.set(id, m => {
      clearTimeout(batas);
      r(m);
    });
    p.stdin.write([id, cmd, ...args].join('\t') + '\n');
  });
function simpan() {
  fs.writeFileSync(path.join(HASIL, 'laporan-mode.txt'), laporan.join('\n') + '\n');
}
async function akhiri(kode) {
  selesai = true;
  await kirim('keluar');
  simpan();
  tulis('\nLaporan: kamera-sony/hasil-uji/laporan-mode.txt — kirim isinya ke Claude.\n');
  setTimeout(() => process.exit(kode), 500);
}
// Ukuran gambar live view (lebar × tinggi) dari JPEG
function ukuranJpeg(b) {
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1],
      len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m))
      return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}
async function liveView() {
  for (let i = 0; i < 20; i++) {
    const x = await kirim('lv');
    if (x.ok && x.jpg) {
      const u = ukuranJpeg(Buffer.from(x.jpg, 'base64'));
      if (u) {
        const r = u[0] / u[1];
        return `${u[0]}×${u[1]} (${Math.abs(r - 16 / 9) < 0.05 ? '16:9' : Math.abs(r - 1.5) < 0.05 ? '3:2' : r.toFixed(2)})`;
      }
    }
    await jeda(150);
  }
  return 'tidak keluar';
}
const nama = m => `${m.jenis.toUpperCase()} (${m.mode})`;

(async () => {
  tulis(`Uji ganti mode kamera Sony — ${new Date().toLocaleString('id-ID')}\n`);
  let r = await kirim('sambung', HASIL);
  if (!r.ok) {
    tulis(`✗ Sambung: ${jelaskanSambung(r)}`);
    return akhiri(1);
  }
  tulis(`✓ Sambung: ${r.model}`);
  r = await kirim('mode');
  if (!r.ok) {
    tulis(
      `✗ Baca mode: ${r.error}${/Perintah tidak dikenal/.test(r.error) ? ' — jalankan dulu: npm run build:sony' : ''}`,
    );
    return akhiri(1);
  }
  const awal = r;
  tulis(`  Mode sekarang: ${nama(r)} · bisa diubah dari komputer: ${r.bisaUbah ? 'ya' : 'TIDAK'}`);
  tulis(`  Pilihan mode yang ditawarkan kamera: ${r.pilihan.join(', ') || '(kosong)'}`);
  tulis(`  Live view: ${await liveView()}`);

  const hasil = {};
  for (const ke of awal.jenis === 'video' ? ['foto', 'video'] : ['video', 'foto']) {
    const t = Date.now();
    r = await kirim('mode', ke);
    hasil[ke] = r.ok;
    if (r.ok) {
      await jeda(1200);
      tulis(
        `${r.ok ? '✓' : '✗'} Pindah ke ${ke.toUpperCase()}: berhasil → ${nama(r)} (${((Date.now() - t) / 1000).toFixed(1)} dtk, ${r.coba}x coba) · live view ${await liveView()}`,
      );
    } else tulis(`✗ Pindah ke ${ke.toUpperCase()}: GAGAL — ${r.error}${r.kode ? ' (' + r.kode + ')' : ''}`);
  }
  // Kembalikan ke mode semula
  r = await kirim('mode', awal.jenis === 'video' ? 'video' : 'foto');
  tulis(`  Dikembalikan ke mode semula: ${r.ok ? nama(r) : 'gagal — ' + r.error}`);

  if (hasil.video && hasil.foto)
    tulis('\n✓ BISA: aplikasi dapat mengganti mode foto ↔ video tanpa memutar tombol kamera.');
  else tulis('\n✗ TIDAK BISA dari komputer: kamera mengikuti posisi tombol Foto/Video di badan kamera.');
  tulis(`  (Posisi tombol fisik saat uji: ${awal.jenis.toUpperCase()})`);
  akhiri(hasil.video && hasil.foto ? 0 : 1);
})();
