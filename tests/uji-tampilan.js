/* =====================================================================
   uji-tampilan.js — uji tampilan: membuka index.html di browser dengan
   kamera palsu dan "api" palsu, lalu menekan tombol seperti tamu.
   Jalankan:  node tests/uji-tampilan.js        (butuh paket playwright)
   Pemasangan sekali:  npm install --save-dev playwright && npx playwright install chromium
   ===================================================================== */
const path = require('path');
const { pathToFileURL } = require('url');
let playwright;
try { playwright = require('playwright'); }
catch (e) {
  console.log('Paket "playwright" belum terpasang. Pasang sekali dengan:\n' +
              '  npm install --save-dev playwright\n  npx playwright install chromium');
  process.exit(1);
}
const { cek, hasil } = require('./bantu');
const HALAMAN = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

// Dipasang di halaman sebelum aplikasi berjalan: kamera palsu + api palsu yang mencatat panggilan
const PALSU = `
window.LOG = []; window.MODE = { startFail: false, mrThrow: false, endOk: true, endMs: 200 };
let nextId = 0, errCb = null;
window.fireRecError = id => errCb && errCb(id, 'ENOSPC: disk penuh');
const ST = { quizSeconds: 2, quizRounds: 2, kiosk: false, accent: '#b08d57', loginId: 'leura' };
window.api = {
  getConfig: async () => ({ quizSeconds: ST.quizSeconds, quizRounds: ST.quizRounds, welcome: '', colors: { accent: ST.accent } }),
  getCouples: async () => ({ activeId: 'a', couples: [
    { id: 'a', name: 'Rina & Dimas', welcome: 'Tinggalkan pesan untuk kami', questions: ['Q satu', 'Q dua', 'Q tiga'] },
    { id: 'b', name: 'Ayu & Budi', welcome: '', questions: ['Q'] }] }),
  login: async (id, pw) => pw === '1234',
  getSessions: async () => [{ time: new Date().toISOString(), label: 'pesan', couple: 'Rina & Dimas', seconds: 42, status: 'done' }],
  getOutDir: async () => ({ dir: '/Users/uji/Documents/VideoboothRecordings', isDefault: true, ok: true }),
  getSettings: async () => ({ ...ST }),
  saveSettings: async p => { LOG.push('setting ' + JSON.stringify(p)); Object.assign(ST, p); return { ...ST }; },
  changeLogin: async (o, id) => o === '1234' ? { ok: true, id } : { error: 'Password lama salah.' },
  getStartupInfo: async () => ({ recovered: 0 }),
  recStart: async label => { LOG.push('start ' + label); return MODE.startFail ? { error: 'Folder penyimpanan tidak bisa ditulisi.' } : { id: ++nextId }; },
  recChunk: () => { LOG.push('chunk'); },
  recEnd: async (id, sec, meta) => { await new Promise(r => setTimeout(r, MODE.endMs)); LOG.push('end ' + id + (meta.aborted ? ' (batal)' : ''));
    return MODE.endOk ? { ok: true } : { ok: false, error: 'ENOSPC' }; },
  recAbort: async id => { LOG.push('abort ' + id); },
  onRecError: cb => { errCb = cb; },
  savePhotos: async p => { window.FOTO = { n: p.originals.length, result: p.result.length, meta: p.meta }; return { ok: true }; },
  saveCouple: async () => ({}), setActiveCouple: async () => ({}), deleteCouple: async () => ({}),
  chooseOutDir: async () => ({ canceled: true }), resetOutDir: async () => ({}), openFolder: async () => '', openCoupleFolder: async () => ''
};
navigator.mediaDevices.getUserMedia = async () => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d');
  setInterval(() => { g.fillStyle = '#' + Math.floor(Math.random() * 999); g.fillRect(0, 0, 640, 360); }, 50);
  const ac = new AudioContext(), d = ac.createMediaStreamDestination(); ac.createOscillator().connect(d);
  return new MediaStream([...c.captureStream(20).getVideoTracks(), ...d.stream.getAudioTracks()]);
};
navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'x', label: 'Kamera uji' }, { kind: 'audioinput', deviceId: 'y', label: 'Mic uji' }];
const RealMR = window.MediaRecorder;
window.MediaRecorder = function (s, o) { if (MODE.mrThrow) throw new Error('codec tidak didukung'); return new RealMR(s, o); };
`;

async function main() {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const pg = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; pg.on('pageerror', e => errors.push(e.message));
  await pg.addInitScript(PALSU);
  await pg.goto(HALAMAN); await pg.waitForTimeout(800);
  const layar = () => pg.evaluate(() => document.querySelector('.screen.on').id);
  const log = () => pg.evaluate(() => LOG.filter(x => x !== 'chunk'));
  const bersihkan = () => pg.evaluate(() => { LOG.length = 0; });
  const atur = m => pg.evaluate(m => Object.assign(MODE, m), m);
  const tunggu = ms => pg.waitForTimeout(ms);
  const tungguLayar = (id, ms = 20000) => pg.waitForSelector('#' + id + '.on', { timeout: ms });

  console.log('\n▶ Halaman awal');
  cek(await layar() === 'start', 'aplikasi dibuka di halaman Start');
  await pg.click('#btnStart');
  cek(await layar() === 'utama' && await pg.textContent('#couple') === 'Rina & Dimas', 'Halaman Utama menampilkan couple aktif');
  cek(await pg.isVisible('#btnToPhoto'), 'tombol Photo booth ada di Halaman Utama');

  console.log('\n▶ Kirim pesan');
  await bersihkan(); await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai');
  await tunggu(4300); await pg.click('#btnFinish');
  await tunggu(500); cek(await layar() === 'saving', 'setelah Selesai muncul layar Menyimpan');
  await tungguLayar('thanks');
  cek(await pg.textContent('#thanksMsg') === 'Rekamanmu sudah tersimpan.', 'Terima kasih: rekaman tersimpan');
  cek(JSON.stringify(await log()) === '["start pesan","end 1"]', 'satu rekaman dimulai dan disimpan', await log());

  console.log('\n▶ Rekaman gagal dimulai tidak membuat layar macet');
  await atur({ startFail: true }); await pg.click('#btnCobaLagi'); await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai');
  await tunggu(3600);
  cek(await layar() === 'utama' && /tidak bisa ditulisi/.test(await pg.textContent('#notice')), 'folder tidak bisa ditulisi: kembali ke Utama dengan pesan');
  await atur({ startFail: false, mrThrow: true }); await bersihkan();
  await pg.click('#btnToQuiz'); await pg.click('#btnQuizMulai'); await tunggu(500);
  cek(await layar() === 'utama' && (await log()).includes('abort 2'), 'perekam gagal dibuat: rekaman dibatalkan & kembali ke Utama', await log());
  await atur({ mrThrow: false });

  console.log('\n▶ Disk penuh di tengah rekaman');
  await bersihkan(); await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai'); await tunggu(4500);
  await pg.evaluate(() => fireRecError(rec.id)); await tunggu(600);
  cek(await layar() === 'utama' && /disk/.test(await pg.textContent('#notice')), 'kembali ke Utama dengan pesan cek disk');
  cek((await log()).some(x => x.endsWith('(batal)')), 'bagian yang sempat terekam tetap disimpan');

  console.log('\n▶ Quiz + Coba lagi cepat');
  await bersihkan(); await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai'); await tunggu(4300);
  await pg.click('#btnFinish'); await tungguLayar('thanks');
  await pg.click('#btnCobaLagi'); await pg.click('#btnToQuiz');
  cek(/2 pertanyaan acak.*2 detik/.test(await pg.textContent('#quizInfo')), 'info quiz mengikuti pengaturan');
  await pg.click('#btnQuizMulai');
  await tungguLayar('thanks', 30000);
  const L = await log();
  cek(L.indexOf('end 4') < L.indexOf('start quiz') && L.includes('end 5'), 'rekaman lama tersimpan sebelum rekaman baru dimulai', L);

  console.log('\n▶ Halaman Terima kasih mengikuti hasil penyimpanan');
  await atur({ endOk: false }); await pg.click('#btnCobaLagi'); await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai');
  await tunggu(4300); await pg.click('#btnFinish'); await tungguLayar('thanks');
  cek(/belum berhasil/.test(await pg.textContent('#thanksMsg')), 'gagal simpan: pesan "belum berhasil tersimpan"');
  await atur({ endOk: true });

  console.log('\n▶ Admin: pengaturan langsung berlaku & panel bisa digulir');
  await pg.click('#btnCobaLagi'); await pg.click('#btnAdminOpen'); await pg.fill('#uid', 'leura'); await pg.fill('#pw', '1234'); await pg.click('#btnLogin');
  await tunggu(400);
  cek(await pg.isVisible('#adminPanel'), 'login Admin berhasil');
  const body = pg.locator('#adminPanel .sheet-body'); const bb = await body.boundingBox();
  await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await pg.mouse.wheel(0, 500); await tunggu(400);
  cek(await body.evaluate(e => e.scrollTop) > 0, 'panel Admin bisa digulir');
  await pg.selectOption('#setSeconds', '30'); await pg.locator('.sw').nth(2).click(); await tunggu(200);
  cek(await pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()) === '#7C9A7E', 'warna langsung berubah');
  await pg.click('#btnAdminBack'); await pg.click('#btnToQuiz');
  cek(/30 detik/.test(await pg.textContent('#quizInfo')), 'waktu jawab baru langsung dipakai quiz');
  await pg.click('#btnQuizBack');

  console.log('\n▶ Photo booth');
  await pg.click('#btnToPhoto');
  cek(/4 kali.*5 detik/.test(await pg.textContent('#pbIntro')), 'penjelasan Photo booth tampil');
  await pg.click('#pbStart'); await tunggu(5600);
  cek(await pg.isVisible('#pbPreview'), 'pratinjau tampil setelah jepretan pertama');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 });
  cek(await pg.locator('.pb-thumb.filled').count() === 4, '4 foto tampil berderet');
  cek(await pg.isVisible('[data-redo="1"]'), 'tombol Ulangi tampil di bawah foto');
  await pg.click('[data-redo="1"]'); await tunggu(500);
  cek(/Ulangi foto 2/.test(await pg.textContent('#pbPillText')) && !(await pg.isVisible('#pbFinish')), 'ulangi foto 2 berjalan');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 15000 });
  await pg.click('#pbFinish'); await tunggu(500);
  cek(await layar() === 'editphoto', 'Finish & edit membuka halaman Edit');
  await pg.click('[data-tab="filter"]'); await pg.locator('#peFilters .pe-opt').nth(1).click();
  await pg.click('[data-tab="sticker"]'); await pg.locator('#peStickerList .pe-stk').first().click();
  cek(await pg.locator('.pe-sticker').count() === 1, 'stiker bisa ditambahkan');
  await pg.click('#peDone'); await tungguLayar('thanks');
  const foto = await pg.evaluate(() => window.FOTO);
  cek(foto && foto.n === 4 && foto.meta.filter === 'bw' && foto.meta.stickers === 1, 'foto disimpan: 4 asli + hasil edit', foto);
  cek(await pg.textContent('#thanksMsg') === 'Fotomu sudah tersimpan.' && await pg.isVisible('#thanksPhoto'), 'Terima kasih menampilkan pratinjau foto');
  await pg.click('#btnCobaLagi'); await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai'); await tunggu(4300);
  await pg.click('#btnFinish'); await tungguLayar('thanks');
  cek(!(await pg.isVisible('#thanksPhoto')), 'setelah sesi video, pratinjau foto tidak ikut tampil');

  console.log('\n▶ Tidak ada error di halaman');
  cek(errors.length === 0, 'tidak ada error JavaScript', errors);

  await browser.close();
  const h = hasil();
  console.log(`\n${h.gagal ? '✗' : '✓'} Uji tampilan: ${h.lulus} lulus, ${h.gagal} gagal`);
  process.exit(h.gagal ? 1 : 0);
}
main().catch(e => { console.log('Uji berhenti: ' + e.message); process.exit(1); });
