/* =====================================================================
   uji-demo.js — uji Leura versi DEMO untuk HP (npm run uji:demo)
   Membangun demo/web, menjalankannya di server kecil, lalu membukanya di
   Chromium dengan ukuran layar HP dan kamera/mic palsu bawaan Chromium.
   Alur: Start → nama → Kirim pesan → Photo booth → Admin → Riwayat → buka ulang.
   ===================================================================== */
const path = require('path');
const fs = require('fs');
let playwright;
try { playwright = require('playwright'); }
catch (e) { console.log('Playwright belum terpasang: npm i -D playwright'); process.exit(1); }
const { cek, hasil } = require('./bantu');
const { bangun, KELUAR } = require('../demo/bangun');

async function main() {
  bangun();
  // Server kecil (localhost boleh memakai kamera)
  const http = require('http');
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(KELUAR, path.normalize(p));
    if (!f.startsWith(KELUAR) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    const jenis = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' }[path.extname(f)];
    res.writeHead(200, { 'Content-Type': jenis || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, r));
  const URL_DEMO = `http://localhost:${server.address().port}/`;

  const browser = await playwright.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['camera', 'microphone'] });
  const pg = await ctx.newPage();
  const errors = []; pg.on('pageerror', e => errors.push(e.message));
  const tunggu = ms => pg.waitForTimeout(ms);
  const tungguLayar = (id, ms = 20000) => pg.waitForSelector('#' + id + '.on', { timeout: ms });
  const layar = () => pg.evaluate(() => document.querySelector('.screen.on').id);
  await pg.goto(URL_DEMO); await tunggu(1500);

  console.log('\n▶ Demo terbuka di HP');
  cek(await layar() === 'start', 'halaman Start tampil');
  cek(await pg.isVisible('.demo-tanda'), 'tanda DEMO tampil di pojok');
  cek(await pg.evaluate(() => { const b = document.getElementById('btnStart').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; }), 'tombol Start muat di lebar layar HP');
  cek(await pg.evaluate(() => !!(mediaStream && mediaStream.getVideoTracks().length)), 'kamera HP terbuka');

  console.log('\n▶ Kirim pesan');
  await pg.click('#btnStart'); await tungguLayar('nama');
  await pg.fill('#namaInput', 'Budi'); await pg.press('#namaInput', 'Enter'); await tungguLayar('utama');
  await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai'); await tunggu(5000);
  await pg.click('#btnFinish'); await tungguLayar('thanks');
  cek(/Budi/.test(await pg.textContent('#thanksNama')), 'Terima kasih menyapa nama tamu');

  console.log('\n▶ Photo booth');
  await pg.click('#btnCobaLagi'); await tungguLayar('utama');
  await pg.click('#btnToPhoto'); await pg.click('#pbStart');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 45000 }); await pg.click('#pbFinish'); await tunggu(600);
  await pg.click('#peDone'); await tungguLayar('thanks');
  cek(await pg.isVisible('#thanksPhoto') && await pg.isVisible('#thanksQR'), 'hasil foto + QR contoh tampil');
  cek(/contoh-unduh\.html/.test(await pg.textContent('#qrLink')), 'QR mengarah ke halaman contoh unduh');
  cek(await pg.evaluate(() => { const r = document.getElementById('thanksPhoto').getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth + 1; }), 'hasil foto muat di layar HP');
  const sesi = await pg.evaluate(() => api.getSessions());
  cek(sesi.length === 2 && sesi.some(s => s.label === 'pesan' && s.tamu === 'Budi') && sesi.some(s => s.label === 'foto'), 'pesan & foto tersimpan di HP', sesi.map(s => s.label));

  console.log('\n▶ Admin');
  await pg.click('#btnCobaLagi'); await tungguLayar('utama');
  await pg.click('#btnAdminOpen'); await tunggu(300);
  cek(/leura/.test(await pg.textContent('.demo-petunjuk')), 'petunjuk login demo tampil');
  await pg.fill('#uid', 'leura'); await pg.fill('#pw', '1234'); await pg.click('#btnLogin'); await tunggu(500);
  cek(await pg.isVisible('#adminPanel'), 'login demo berhasil, Admin terbuka');

  console.log('\n▶ Tersimpan setelah halaman dibuka ulang');
  await pg.reload(); await tunggu(1500);
  await pg.evaluate(() => show('utama')); await pg.click('#btnAdminOpen'); await tunggu(300);
  await pg.fill('#uid', 'leura'); await pg.fill('#pw', '1234'); await pg.click('#btnLogin'); await tunggu(500);
  await pg.click('#btnRiwayat'); await tungguLayar('riwayat'); await tunggu(800);
  cek(await pg.locator('#rwList .rw-row').count() === 2, 'Riwayat sesi berisi 2 sesi');
  await pg.locator('#rwList .rw-row', { hasText: 'Pesan' }).click(); await tunggu(300);
  await pg.locator('#rwList button', { hasText: 'Putar video' }).click(); await tunggu(800);
  cek(await pg.evaluate(() => { const v = document.querySelector('.demo-putar video'); return !!v && v.src.startsWith('blob:'); }), 'video pesan bisa diputar dari Riwayat');
  await pg.click('.demo-putar .btn');

  console.log('\n▶ Tidak ada error di halaman');
  cek(errors.length === 0, 'tidak ada error JavaScript', errors);

  await browser.close(); server.close();
  const h = hasil();
  console.log(`\n${h.gagal ? '✗' : '✓'} Uji demo: ${h.lulus} lulus, ${h.gagal} gagal`);
  process.exit(h.gagal ? 1 : 0);
}
main().catch(e => { console.log('Uji berhenti: ' + e.message); process.exit(1); });
