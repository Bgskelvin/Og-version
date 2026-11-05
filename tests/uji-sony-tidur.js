/* =====================================================================
   uji-sony-tidur.js — apakah kamera Sony bisa "istirahat" lalu dipakai lagi
   tanpa disentuh? (uji dengan kamera ASLI, bukan uji otomatis)
   Jalankan:   npm run uji:sony-tidur            (menunggu 2 menit)
               npm run uji:sony-tidur -- --menit 5

   Sebelum mulai: di kamera, MENU → Setup → Power Setting Option →
   Power Save Start Time = 1 Min.  (Kembalikan ke 30 Min setelah uji!)

   Uji 1: lepas sambungan → 5 detik → sambung lagi (mode istirahat ringan)
   Uji 2: lepas sambungan → tunggu kamera tertidur → coba bangunkan lewat USB
   Hasil: kamera-sony/hasil-uji/laporan-tidur.txt
   ===================================================================== */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { jelaskanSambung } = require('../main/pesan-sony');

const AKAR = path.join(__dirname, '..');
const HELPER = process.env.SONY_HELPER || path.join(AKAR, 'kamera-sony', 'bin', 'sony-helper');
const HASIL = path.join(AKAR, 'kamera-sony', 'hasil-uji');
const iMenit = process.argv.indexOf('--menit');
const MENIT = Math.max(1, Number(iMenit > 0 ? process.argv[iMenit + 1] : 2) || 2);
const laporan = [];
const tulis = t => { console.log(t); laporan.push(t); };
const detik = ms => (ms / 1000).toFixed(1) + ' dtk';
const jeda = ms => new Promise(r => setTimeout(r, ms));

if (!fs.existsSync(HELPER)) { console.log('\n✗ Program kamera Sony belum dibuat. Jalankan dulu:  npm run build:sony\n'); process.exit(1); }
fs.mkdirSync(HASIL, { recursive: true });

const p = spawn(HELPER, [], { cwd: path.dirname(HELPER) });
let seq = 0, selesai = false;
const tunggu = new Map();
readline.createInterface({ input: p.stdout }).on('line', l => {
  if (!l.startsWith('{')) return;
  let m; try { m = JSON.parse(l); } catch (e) { return; }
  if (m.ev) { if (!['unduh-progres', 'foto-masuk', 'siap'].includes(m.ev)) tulis(`   (kabar kamera: ${m.ev}${m.kode ? ' ' + m.kode : ''})`); return; }
  const t = tunggu.get(m.id); if (t) { tunggu.delete(m.id); t(m); }
});
p.stderr.on('data', d => tulis('   [stderr] ' + String(d).trim()));
p.on('exit', c => { if (!selesai) { tulis(`\n✗ Program kamera berhenti mendadak (kode ${c}).`); simpan(); process.exit(1); } });
const kirim = (cmd, ...args) => new Promise(r => {
  const id = ++seq;
  const batas = setTimeout(() => { tunggu.delete(id); r({ ok: false, error: 'tidak ada jawaban (' + cmd + ')' }); }, 40000);
  tunggu.set(id, m => { clearTimeout(batas); r(m); });
  p.stdin.write([id, cmd, ...args].join('\t') + '\n');
});
function simpan() { fs.writeFileSync(path.join(HASIL, 'laporan-tidur.txt'), laporan.join('\n') + '\n'); }
async function akhiri(kode) {
  selesai = true;
  await kirim('keluar');
  simpan();
  tulis('\nLaporan: kamera-sony/hasil-uji/laporan-tidur.txt — kirim isinya ke Claude.');
  tulis('Jangan lupa: kembalikan Power Save Start Time kamera ke 30 Min.\n');
  setTimeout(() => process.exit(kode), 500);
}
// Sambung + ambil 1 gambar live view. Kembali: { ok, ms, pesan }
async function sambungDanLihat() {
  const t = Date.now();
  const r = await kirim('sambung', HASIL);
  if (!r.ok) return { ok: false, ms: Date.now() - t, pesan: jelaskanSambung(r) };
  for (let i = 0; i < 30; i++) {
    const x = await kirim('lv');
    if (x.ok && x.jpg) return { ok: true, ms: Date.now() - t, model: r.model };
    await jeda(200);
  }
  return { ok: false, ms: Date.now() - t, pesan: 'tersambung, tapi live view tidak keluar' };
}

(async () => {
  tulis(`Uji istirahat kamera Sony — ${new Date().toLocaleString('id-ID')} (tunggu tidur: ${MENIT} menit)\n`);
  let r = await sambungDanLihat();
  if (!r.ok) { tulis(`✗ Sambung awal gagal: ${r.pesan}`); return akhiri(1); }
  tulis(`✓ Sambung awal: ${r.model}, live view keluar (${detik(r.ms)})`);

  // Uji 1: istirahat ringan
  await kirim('putus'); await jeda(5000);
  r = await sambungDanLihat();
  tulis(r.ok ? `✓ Uji 1 — lepas 5 detik lalu sambung lagi: berhasil (${detik(r.ms)})`
             : `✗ Uji 1 — lepas 5 detik lalu sambung lagi: GAGAL — ${r.pesan}`);
  if (!r.ok) return akhiri(1);

  // Uji 2: biarkan kamera tertidur
  await kirim('putus');
  tulis(`\n… Uji 2: sambungan dilepas. JANGAN sentuh kamera selama ${MENIT} menit.`);
  tulis('   Perhatikan layar kamera: apakah menjadi gelap (tertidur)? Catat jam berapa.');
  const akhir = Date.now() + MENIT * 60000;
  while (Date.now() < akhir) {
    const sisa = Math.ceil((akhir - Date.now()) / 1000);
    process.stdout.write(`\r   menunggu… ${Math.floor(sisa / 60)}:${String(sisa % 60).padStart(2, '0')}   `);
    await jeda(1000);
  }
  process.stdout.write('\n');
  tulis('   Mencoba membangunkan kamera lewat USB…');
  let berhasil = null;
  for (let coba = 1; coba <= 3 && !berhasil; coba++) {
    r = await sambungDanLihat();
    if (r.ok) berhasil = r;
    else { tulis(`   percobaan ${coba}: gagal — ${r.pesan}`); await jeda(3000); }
  }
  if (berhasil) {
    tulis(`✓ Uji 2 — kamera bisa dipakai lagi lewat USB tanpa disentuh (${detik(berhasil.ms)}).`);
    tulis('   → Aplikasi bisa membiarkan kamera tidur saat booth sepi.');
  } else {
    tulis('✗ Uji 2 — kamera TIDAK bisa dibangunkan lewat USB.');
    tulis('   → Tekan setengah tombol shutter, lalu tulis ke Claude apakah setelah itu kamera mau tersambung.');
    tulis('   → Untuk acara: Power Save tetap paling lama; aplikasi cukup memakai mode istirahat ringan (Uji 1).');
  }
  akhiri(berhasil ? 0 : 1);
})();
