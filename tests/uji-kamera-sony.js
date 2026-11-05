/* =====================================================================
   uji-kamera-sony.js — uji dengan kamera Sony ASLI (bukan uji otomatis)
   Jalankan dengan kamera tersambung:   npm run uji:sony
   Opsi:  --tanpa-video   lewati uji rekam video

   Mengukur: sambung, live view (gambar/detik), jepret + foto masuk,
   rekam video 10 detik + salin ke komputer (MB/detik).
   Hasilnya ditulis ke kamera-sony/hasil-uji/ (laporan.txt + contoh file).
   ===================================================================== */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const AKAR = path.join(__dirname, '..');
const HELPER = process.env.SONY_HELPER || path.join(AKAR, 'kamera-sony', 'bin', 'sony-helper');
const HASIL = path.join(AKAR, 'kamera-sony', 'hasil-uji');
const TANPA_VIDEO = process.argv.includes('--tanpa-video');
const laporan = [];
const tulis = t => { console.log(t); laporan.push(t); };
const detik = ms => (ms / 1000).toFixed(1) + ' dtk';

if (!fs.existsSync(HELPER)) {
  console.log('\n✗ Program kamera Sony belum dibuat. Jalankan dulu:  npm run build:sony\n');
  process.exit(1);
}
fs.rmSync(HASIL, { recursive: true, force: true });
fs.mkdirSync(HASIL, { recursive: true });

// Ukuran foto JPEG (lebar × tinggi) dari penanda SOF
function ukuranJpeg(b) {
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return `${b.readUInt16BE(i + 7)}×${b.readUInt16BE(i + 5)}`;
    i += 2 + len;
  }
  return '?';
}

const p = spawn(HELPER, [], { cwd: path.dirname(HELPER) });
let seq = 0;
const tunggu = new Map(), kabar = [];
readline.createInterface({ input: p.stdout }).on('line', l => {
  if (!l.startsWith('{')) return;
  const m = JSON.parse(l);
  if (m.ev) { kabar.push(m); if (m.ev !== 'unduh-progres' && m.ev !== 'foto-masuk') tulis(`   (kabar kamera: ${m.ev}${m.kode ? ' ' + m.kode : ''})`); return; }
  const t = tunggu.get(m.id); if (t) { tunggu.delete(m.id); t(m); }
});
p.stderr.on('data', d => tulis('   [stderr] ' + String(d).trim()));
p.on('exit', c => { if (!selesai) { tulis(`\n✗ Program kamera berhenti mendadak (kode ${c}).`); simpanLaporan(); process.exit(1); } });
const kirim = (cmd, ...args) => new Promise(r => { const id = ++seq; tunggu.set(id, r); p.stdin.write([id, cmd, ...args].join('\t') + '\n'); });
const jeda = ms => new Promise(r => setTimeout(r, ms));
let selesai = false;
function simpanLaporan() { fs.writeFileSync(path.join(HASIL, 'laporan.txt'), laporan.join('\n') + '\n'); }

(async () => {
  tulis(`Uji kamera Sony — ${new Date().toLocaleString('id-ID')}\n`);
  let t = Date.now();
  let r = await kirim('sambung', HASIL);
  if (!r.ok) { tulis(`✗ Sambung: ${require('../main/pesan-sony').jelaskanSambung(r)}`); return akhiri(1); }
  tulis(`✓ Sambung: ${r.model} (${detik(Date.now() - t)})${r.catatan ? '  ⚠ pengaturan gagal: ' + r.catatan : ''}`);

  r = await kirim('status');
  tulis(`✓ Status: baterai ${r.baterai}%, kartu ${r.kartu === 0 ? 'OK' : 'BERMASALAH (' + r.kartu + ')'}, sisa rekam ${Math.round(r.sisaDetik / 60)} menit, sisa foto ${r.sisaFoto}`);

  // Live view selama 3 detik: hitung gambar yang BERBEDA (SDK bisa mengirim ulang gambar yang sama)
  t = Date.now();
  let n = 0, beda = 0, terakhir = '', terbesar = null;
  while (Date.now() - t < 3000) {
    const x = await kirim('lv');
    if (!x.ok) { await jeda(100); continue; }
    n++;
    const b = Buffer.from(x.jpg, 'base64');
    const sidik = b.length + ':' + b.subarray(b.length - 64).toString('hex');
    if (sidik !== terakhir) { beda++; terakhir = sidik; }
    if (!terbesar || b.length > terbesar.length) terbesar = b;
    await jeda(10);
  }
  const fps = beda / ((Date.now() - t) / 1000);
  if (terbesar) fs.writeFileSync(path.join(HASIL, 'liveview.jpg'), terbesar);
  tulis(`${beda ? '✓' : '✗'} Live view: ±${fps.toFixed(1)} gambar baru/detik (${n} diminta), ukuran ${terbesar ? ukuranJpeg(terbesar) : '-'}`);

  // Jepret 3 kali
  for (let i = 1; i <= 3; i++) {
    t = Date.now();
    const f = await kirim('foto', HASIL);
    if (!f.ok) { tulis(`✗ Jepret ${i}: ${f.error} ${f.kode || ''}`); continue; }
    const b = fs.readFileSync(f.file);
    tulis(`✓ Jepret ${i}: foto masuk dalam ${detik(Date.now() - t)}, ${(b.length / 1e6).toFixed(1)} MB, ${ukuranJpeg(b)} (${path.basename(f.file)}) · lewat ${f.sumber === 'kartu' ? 'kartu SD' : 'post view'} · fokus: ${f.fokus}`);
    await jeda(800);
  }

  if (!TANPA_VIDEO) {
    t = Date.now();
    r = await kirim('rekam-mulai');
    if (!r.ok) { tulis(`✗ Mulai rekam: ${r.error} ${r.kode || ''}`); return akhiri(1); }
    tulis(`✓ Mulai rekam (${detik(Date.now() - t)}) — merekam 10 detik…`);
    await jeda(10000);
    t = Date.now();
    r = await kirim('rekam-stop');
    if (!r.ok) { tulis(`✗ Berhenti rekam: ${r.error} ${r.kode || ''}`); return akhiri(1); }
    tulis(`✓ Berhenti rekam & file ditemukan dalam ${detik(Date.now() - t)}: ${r.nama}, ${(r.ukuran / 1e6).toFixed(1)} MB`);
    t = Date.now();
    const u = await kirim('unduh', r.slot, r.contentId, r.fileId, HASIL);
    if (!u.ok) { tulis(`✗ Salin video: ${u.error} ${u.kode || ''}`); return akhiri(1); }
    while (!kabar.some(k => (k.ev === 'unduh-selesai' || k.ev === 'unduh-gagal') && k.job === u.job)) {
      if (Date.now() - t > 10 * 60000) { tulis('✗ Salin video: lebih dari 10 menit'); return akhiri(1); }
      await jeda(200);
    }
    const k = kabar.find(k => k.job === u.job && (k.ev === 'unduh-selesai' || k.ev === 'unduh-gagal'));
    if (k.ev === 'unduh-gagal') { tulis(`✗ Salin video gagal (${k.kode})`); return akhiri(1); }
    const ms = Date.now() - t, mb = fs.statSync(k.file).size / 1e6;
    tulis(`✓ Salin video: ${mb.toFixed(1)} MB dalam ${detik(ms)} (±${(mb / (ms / 1000)).toFixed(1)} MB/detik)`);
    tulis(`   → pesan 1 menit dengan pengaturan ini ±${(mb * 6).toFixed(0)} MB, disalin ±${detik(ms * 6)}`);
  }
  akhiri(0);
})();

async function akhiri(kode) {
  selesai = true;
  await kirim('keluar');
  simpanLaporan();
  console.log(`\nLaporan & contoh file: kamera-sony/hasil-uji/\nKirim isi laporan.txt ke Claude.\n`);
  setTimeout(() => process.exit(kode), 500);
}
