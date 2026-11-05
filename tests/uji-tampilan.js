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
window.LOG = []; window.TPL = [];
window.UNG = { st: { aktif: false, url: '', adaKunci: false, menunggu: 0, terkirim: 0, errorTerakhir: '', adaHasilPasang: true }, cb: null };
// Kamera Sony tiruan (proses utama aslinya diuji di uji-utama.js)
window.SONY = { st: { mode: 'webcam', tersambung: false, pesan: '' }, cb: null, foto: 0, besar: 0 };
window.buatJpeg = async (w, h, warna) => { const c = new OffscreenCanvas(w, h); const g = c.getContext('2d');
  g.fillStyle = warna; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(w / 4, h / 4, w / 2, h / 2);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer()); };
window.setSony = st => { SONY.st = st; setTimeout(() => SONY.cb && SONY.cb(st), 30); };
window.CP = { activeId: 'a', couples: [
  { id: 'a', name: 'Rina & Dimas', welcome: 'Tinggalkan pesan untuk kami', questions: ['Q satu', 'Q dua', 'Q tiga'] },
  { id: 'b', name: 'Ayu & Budi', welcome: '', questions: ['Q'] }] }; window.MODE = { startFail: false, mrThrow: false, endOk: true, endMs: 200 };
let nextId = 0, errCb = null;
window.fireRecError = id => errCb && errCb(id, 'ENOSPC: disk penuh');
const ST = { quizSeconds: 2, quizRounds: 2, kiosk: false, accent: '#b08d57', loginId: 'leura', pesanCountdown: 3, pesanMaxSeconds: 0,
  photoCountdown: 5, photoPreview: 2, photoFlash: true, enablePesan: true, enableQuiz: true, enablePhoto: true };
window.api = {
  getConfig: async () => ({ ...ST, welcome: '', colors: { accent: ST.accent } }),
  getCouples: async () => JSON.parse(JSON.stringify(CP)),
  saveCouple: async c => { const q = c.questions.map(x => x.trim()).filter(Boolean);
    if (!c.name.trim()) return { error: 'Nama couple wajib diisi.' };
    if (!Object.values(c.menu).some(Boolean)) return { error: 'Minimal satu menu harus aktif.' };
    if (c.menu.quiz && !q.length) return { error: 'Quick quiz aktif: isi minimal 1 pertanyaan, atau matikan Quick quiz.' };
    const baru = { id: c.id || 'n' + CP.couples.length, name: c.name.trim(), welcome: c.welcome, questions: q, menu: c.menu };
    const i = CP.couples.findIndex(x => x.id === baru.id); if (i < 0) CP.couples.push(baru); else CP.couples[i] = baru;
    return { ok: true, couple: baru, data: JSON.parse(JSON.stringify(CP)) }; },
  setActiveCouple: async id => { CP.activeId = id; return { ok: true, data: JSON.parse(JSON.stringify(CP)) }; },
  deleteCouple: async id => { CP.couples = CP.couples.filter(c => c.id !== id); if (CP.activeId === id) CP.activeId = CP.couples[0].id;
    const n = TPL.filter(t => t.coupleId === id).length; TPL = TPL.filter(t => t.coupleId !== id);
    return { ok: true, data: JSON.parse(JSON.stringify(CP)), templateDihapus: n }; },
  countTemplates: async () => TPL.reduce((n, t) => (n[t.coupleId] = (n[t.coupleId] || 0) + 1, n), {}),
  login: async (id, pw) => pw === '1234',
  getSessions: async () => window.SESI || [{ time: new Date().toISOString(), label: 'pesan', couple: 'Rina & Dimas', seconds: 42, status: 'done' }],
  sessionOpen: async id => { LOG.push('buka ' + id); return { ok: true }; },
  sessionReveal: async id => { LOG.push('finder ' + id); return { ok: true }; },
  sessionThumb: async () => null,
  sessionRetry: async id => { LOG.push('ulang ' + id); const s = SESI.find(x => x.id === id); s.status = s.status === 'card-only' ? 'transfer' : 'processing'; return { ok: true }; },
  getOutDir: async () => ({ dir: '/Users/uji/Documents/VideoboothRecordings', isDefault: true, ok: true }),
  getSettings: async () => ({ ...ST }),
  sonyStatus: async () => SONY.st,
  onSonyStatus: cb => { SONY.cb = cb; },
  sonySambungUlang: async () => SONY.st,
  sonyLiveView: async () => SONY.st.tersambung ? buatJpeg(640, 424, '#336') : null,
  sonyFoto: async () => { SONY.foto++; const b = await buatJpeg(3600, 2400, '#a64'); SONY.besar = b.length; return { ok: true, bytes: b }; },
  saveSettings: async p => { LOG.push('setting ' + JSON.stringify(p));
    if (p.kamera) setSony(p.kamera === 'webcam' ? { mode: 'webcam', tersambung: false, pesan: '' }
      : { mode: p.kamera, tersambung: true, model: 'ILCE-6700 (simulasi)', baterai: 100, kartu: 0, sisaDetik: 9000, pesan: '' });
    const next = { ...ST, ...p };   // sama seperti main/pengaturan.js: minimal satu menu tetap tampil
    if (!next.enablePesan && !next.enableQuiz && !next.enablePhoto) return { ...ST, error: 'Minimal satu menu harus tetap tampil di Halaman Utama.' };
    Object.assign(ST, p); return { ...ST }; },
  changeLogin: async (o, id) => o === '1234' ? { ok: true, id } : { error: 'Password lama salah.' },
  getStartupInfo: async () => ({ recovered: 0 }),
  recStart: async (label, o) => { LOG.push('start ' + label + (o && o.sony ? ' sony' : '')); return MODE.startFail ? { error: 'Folder penyimpanan tidak bisa ditulisi.' } : { id: ++nextId }; },
  recChunk: () => { LOG.push('chunk'); },
  recEnd: async (id, sec, meta) => { await new Promise(r => setTimeout(r, MODE.endMs)); LOG.push('end ' + id + (meta.aborted ? ' (batal)' : ''));
    return MODE.endOk ? { ok: true } : { ok: false, error: 'ENOSPC' }; },
  recAbort: async id => { LOG.push('abort ' + id); },
  onRecError: cb => { errCb = cb; },
  savePhotos: async p => { window.FOTO = { n: p.originals.length, result: p.result.length, meta: p.meta, asli: p.originals.map(o => o.length) };
    return { ok: true, link: UNG.st.aktif ? 'https://leura-foto.uji.workers.dev/f/Ab3dEf9hJk' : null }; },
  unggahStatus: async () => ({ ...UNG.st }),
  unggahSimpan: async p => { LOG.push('unggah ' + JSON.stringify(p)); Object.assign(UNG.st, p.url != null ? { url: p.url } : {}, p.kunci ? { adaKunci: true } : {}, p.aktif != null ? { aktif: p.aktif } : {}); return { ...UNG.st }; },
  unggahTes: async () => ({ ok: true, hari: 7 }),
  unggahHasilPasang: async () => ({ url: 'https://leura-foto.uji.workers.dev', kunci: 'abc123' }),
  unggahCobaSekarang: async () => { LOG.push('unggah coba'); return { ...UNG.st }; },
  onUnggahStatus: cb => { UNG.cb = cb; },
  cekTutup: async () => (window.TUTUP || { salin: 0, proses: 0, foto: 0 }),
  tutupAplikasi: async () => { LOG.push('tutup aplikasi'); return { ok: true }; },
  bukaLink: async u => { LOG.push('buka ' + u); return { ok: true }; },
  salinTeks: async t => { LOG.push('salin ' + t); return { ok: true }; },
  listTemplates: async id => TPL.filter(t => t.coupleId === id).map(t => ({ ...t })),
  saveTemplate: async (t, g) => { window.SIMPAN_TPL = { t: JSON.parse(JSON.stringify(t)), bingkai: g.bingkai ? g.bingkai.length : g.bingkai };
    const lama = TPL.find(x => x.id === t.id) || {};
    let bingkaiUrl = lama.bingkaiUrl || null;
    if (g.bingkai) bingkaiUrl = 'data:image/png;base64,' + btoa(String.fromCharCode(...g.bingkai)); else if (g.bingkai === null) bingkaiUrl = null;
    const baru = { ...t, latarUrl: null, bingkaiUrl, diubah: Date.now() };
    const i = TPL.findIndex(x => x.id === t.id); if (i < 0) TPL.push(baru); else TPL[i] = baru;
    return { ok: true, template: baru }; },
  deleteTemplate: async id => { TPL.splice(TPL.findIndex(x => x.id === id), 1); return { ok: true }; },
  chooseOutDir: async () => ({ canceled: true }), resetOutDir: async () => ({}), openFolder: async () => '', openCoupleFolder: async id => { LOG.push('folder ' + id); return ''; }
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
  cek(/2 pertanyaan acak · 2 detik/.test(await pg.textContent('#quizInfo')), 'info quiz mengikuti pengaturan');
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
  await pg.waitForSelector('#adminPanel', { state: 'visible', timeout: 5000 }).catch(() => {}); await tunggu(300);
  cek(await pg.isVisible('#adminPanel'), 'login Admin berhasil');
  const body = pg.locator('#adminPanel .sheet-body'); const bb = await body.boundingBox();
  await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await pg.mouse.wheel(0, 500); await tunggu(400);
  cek(await body.evaluate(e => e.scrollTop) > 0, 'panel Admin bisa digulir');
  await pg.locator('.sw').nth(2).click(); await tunggu(200);
  cek(await pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()) === '#7C9A7E', 'warna langsung berubah');

  console.log('\n▶ Pengaturan videobooth');
  await pg.locator('#btnSetVideo').scrollIntoViewIfNeeded(); await pg.click('#btnSetVideo'); await tunggu(300);
  cek(await layar() === 'setvideo', 'halaman Pengaturan videobooth terbuka dari Admin');
  await pg.selectOption('#setSeconds', '30'); await tunggu(150);
  await pg.selectOption('#setPesanCountdown', '0'); await tunggu(150);
  cek(/Hitung mundur pesan: langsung merekam/.test(await pg.textContent('#setVideoMsg')), 'konfirmasi tersimpan tampil');
  await pg.click('#btnSetVideoBack');
  cek(await layar() === 'admin', 'tombol Admin kembali ke halaman Admin');

  console.log('\n▶ Pengaturan photobooth');
  await pg.locator('#btnSetPhoto').scrollIntoViewIfNeeded(); await pg.click('#btnSetPhoto'); await tunggu(300);
  cek(await layar() === 'setphoto', 'halaman Pengaturan photobooth terbuka dari Admin');
  await pg.selectOption('#setPhotoCountdown', '3'); await pg.selectOption('#setPhotoPreview', '0'); await tunggu(150);
  await pg.click('#setPhotoFlash'); await tunggu(150);
  cek(!(await pg.isVisible('#setEnablePhoto')) && /per couple/.test(await pg.textContent('#setphoto')), 'saklar menu tidak lagi di Pengaturan photobooth (pindah ke couple)');

  console.log('\n▶ Halaman couple & editor template');
  await pg.click('#btnSetPhotoBack'); await tunggu(300);
  const baris = pg.locator('#coupleList .cp-row');
  cek(await baris.count() === 2 && /Rina & Dimas.*Aktif/.test(await baris.first().textContent()) && /Pesan, Quiz \(3 soal\), Foto · 0 template · 1 sesi/.test(await baris.first().textContent()),
      'Admin menampilkan daftar couple, couple aktif paling atas', await baris.first().textContent());
  await baris.nth(1).click(); await tunggu(300);
  cek(await layar() === 'tambah' && await pg.textContent('#tambahTitle') === 'Ayu & Budi' && await pg.isVisible('#btnTplNew'),
      'ketuk couple membuka halaman couple itu, lengkap dengan bagian template');
  await pg.click('#btnTambahBatal'); await baris.first().click(); await tunggu(300);
  cek(await pg.textContent('#tambahTitle') === 'Rina & Dimas' && /Belum ada template/.test(await pg.textContent('#tplList')),
      'template couple Rina & Dimas masih kosong');
  await pg.click('#btnTplNew'); await tunggu(400);
  cek(await layar() === 'tpleditor' && await pg.locator('.te-slot').count() === 4, 'editor template terbuka dengan kotak foto 1-4');
  const rasioSlot = () => pg.evaluate(() => te.tpl.slots.map(s => s.w / s.h));
  cek(await pg.evaluate(() => te.tpl.rasio) === '3:2' && (await rasioSlot()).every(r => Math.abs(r - 1.5) < 0.01), 'template baru memakai rasio 3:2 (sama dengan foto kamera)');
  await pg.click('[data-tab="foto"]'); await pg.locator('#teRasio .pe-opt', { hasText: '1:1' }).click(); await tunggu(150);
  cek((await rasioSlot()).every(r => Math.abs(r - 1) < 0.01) && /rasio 1:1/.test(await pg.textContent('#teRasioInfo')), 'pilih rasio 1:1: semua kotak foto jadi persegi', await rasioSlot());
  await pg.click('[data-tab="desain"]');
  cek(/Rina & Dimas/.test(await pg.textContent('#teTitle')), 'judul editor menyebut couple-nya', await pg.textContent('#teTitle'));
  await pg.fill('#teNama', 'Rustic emas');
  const slot = await pg.locator('.te-slot').first().boundingBox();
  const x0 = await pg.evaluate(() => te.tpl.slots[0].x);
  await pg.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2); await pg.mouse.down();
  await pg.mouse.move(slot.x + slot.width / 2 + 40, slot.y + slot.height / 2 + 30, { steps: 5 }); await pg.mouse.up();
  cek(await pg.evaluate(() => te.tpl.slots[0].x) > x0 + 40, 'kotak foto 1 bisa digeser dengan jari');
  const pj = await pg.locator('.te-slot').nth(1).locator('.te-resize').boundingBox();
  const w0 = await pg.evaluate(() => te.tpl.slots[1].w);
  await pg.mouse.move(pj.x + pj.width / 2, pj.y + pj.height / 2); await pg.mouse.down();
  await pg.mouse.move(pj.x - 30, pj.y + pj.height / 2, { steps: 5 }); await pg.mouse.up();
  cek(await pg.evaluate(() => te.tpl.slots[1].w) < w0, 'ukuran kotak foto bisa diubah dari pojoknya');
  cek(await pg.evaluate(() => Math.abs(te.tpl.slots[1].w - te.tpl.slots[1].h) <= 1), 'saat diubah ukurannya, rasio kotak foto tetap 1:1');
  const posisi = await pg.evaluate(() => JSON.stringify(te.tpl.slots.slice(0, 2)));
  await pg.click('[data-tab="foto"]'); await pg.locator('#teSlotPilih button').first().click(); await pg.click('#teSlotTukar');
  cek(await pg.evaluate(p => JSON.stringify([te.tpl.slots[1], te.tpl.slots[0]]) === p, posisi), 'posisi foto 1 dan 2 bisa ditukar');
  await pg.locator('#teSusunan .pe-opt').nth(1).click();
  cek(await pg.evaluate(() => te.tpl.slots.every(s => s.x === te.tpl.slots[0].x)), 'susunan cepat "Kolom" dipakai');
  await pg.click('[data-tab="teks"]'); await pg.click('#teTeksTambah'); await pg.fill('#teTeksIsi', 'Terima kasih sudah datang');
  await pg.locator('#teTeksFont button').nth(1).click();
  cek(await pg.evaluate(() => te.tpl.texts.length === 3 && te.tpl.texts[2].text === 'Terima kasih sudah datang' && te.tpl.texts[2].font === 'serif'),
      'teks baru ditambahkan & hurufnya bisa diganti', await pg.evaluate(() => te.tpl.texts.map(t => t.text + '|' + t.font)));
  await pg.click('[data-tab="desain"]'); await pg.locator('#teUkuran .pe-opt').nth(2).click(); await tunggu(200);
  cek(await pg.evaluate(() => te.tpl.W === 600 && te.tpl.H === 1800 && te.tpl.slots.every(s => s.x + s.w <= 600 && Math.abs(s.w / s.h - 1) < 0.02)), 'ganti ukuran ke Strip: posisi menyesuaikan, rasio tetap');
  await pg.locator('#teUkuran .pe-opt').nth(0).click(); await tunggu(200);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await pg.setInputFiles('#teBingkaiFile', { name: 'bingkai.png', mimeType: 'image/png', buffer: png }); await tunggu(300);
  cek(/bingkai\.png/.test(await pg.textContent('#teBingkaiStatus')), 'bingkai PNG bisa diunggah');
  await pg.setInputFiles('#teBingkaiFile', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: png }); await tunggu(200);
  cek(/harus PNG/.test(await pg.textContent('#teMsg')), 'bingkai JPG ditolak dengan pesan jelas');
  await pg.click('#teSimpan'); await tunggu(400);
  const simpan = await pg.evaluate(() => window.SIMPAN_TPL);
  cek(await layar() === 'tambah' && simpan.t.nama === 'Rustic emas' && simpan.t.coupleId === 'a' && simpan.bingkai === png.length,
      'template tersimpan untuk couple aktif beserta bingkainya', simpan && { nama: simpan.t.nama, bingkai: simpan.bingkai });
  cek(await pg.locator('#tplList .tpl-row').count() === 1 && /Rustic emas/.test(await pg.textContent('#tplList')), 'template tampil di daftar');
  await pg.locator('#tplList .tpl-row button', { hasText: 'Edit' }).click(); await tunggu(300);
  cek(await pg.inputValue('#teNama') === 'Rustic emas' && /bingkai/i.test(await pg.textContent('#teBingkaiStatus')), 'template bisa dibuka lagi untuk diedit');
  await pg.fill('#teNama', 'Rustic emas 2'); await pg.click('#teBatal');
  cek(await layar() === 'tpleditor' && /Buang/.test(await pg.textContent('#teBatal')), 'Batal dengan perubahan minta konfirmasi');
  await pg.click('#teBatal'); await tunggu(200);
  cek(await layar() === 'tambah' && await pg.evaluate(() => TPL[0].nama) === 'Rustic emas', 'Batal tidak menyimpan perubahan');
  cek(await pg.evaluate(() => TPL[0].rasio) === '1:1', 'rasio foto ikut tersimpan di template');
  await pg.evaluate(() => bukaEditorTemplate({ ...TPL[0], id: 'lama', rasio: undefined })); await tunggu(300);
  await pg.click('#teSimpan'); await tunggu(200);
  cek(await layar() === 'tpleditor' && /Pilih rasio foto dulu/.test(await pg.textContent('#teMsg')) && /belum punya rasio/.test(await pg.textContent('#teRasioInfo')),
      'template lama tanpa rasio tidak bisa disimpan sebelum rasio dipilih');
  await pg.click('#teBatal'); await tunggu(200);
  console.log('\n▶ Menu per couple');
  cek(await pg.isChecked('#fMenuPesan') && await pg.isChecked('#fMenuQuiz') && await pg.isChecked('#fMenuPhoto'), 'halaman couple menampilkan saklar 3 menu');
  await pg.click('#fMenuPesan'); await pg.click('#fMenuQuiz'); await pg.click('#fMenuPhoto'); await tunggu(100);
  cek(await pg.isChecked('#fMenuPhoto') && /Minimal satu menu/.test(await pg.textContent('#fMenuMsg')), 'menu terakhir tidak bisa dimatikan');
  await pg.click('#fMenuPesan'); await pg.click('#btnTambahSimpan'); await tunggu(300);
  const menuA = await pg.evaluate(() => CP.couples[0].menu);
  cek(await layar() === 'admin' && menuA.pesan && !menuA.quiz && menuA.photo, 'menu couple tersimpan (Quick quiz mati)', menuA);
  cek(/Rina & Dimas.*Pesan, Foto · 1 template/.test(await baris.first().textContent()), 'daftar couple menunjukkan menu aktif & jumlah template', await baris.first().textContent());
  await pg.click('#btnAdminBack');
  cek(!(await pg.isVisible('#btnToQuiz')) && await pg.isVisible('#btnToPesan') && await pg.isVisible('#btnToPhoto'),
      'Halaman Utama: Quick quiz tersembunyi, menu lain tetap tampil');

  console.log('\n▶ Pengaturan dipakai saat sesi');
  await bersihkan(); await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai'); await tunggu(400);
  cek((await log()).includes('start pesan') && !(await pg.isVisible('#countOverlay')), 'hitung mundur "langsung merekam": rekaman mulai tanpa menunggu');
  await pg.click('#btnFinish'); await tungguLayar('thanks'); await pg.click('#btnCobaLagi');
  await pg.evaluate(() => applySettings({ ...cfg, pesanMaxSeconds: 2 }));
  await bersihkan(); await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai'); await tunggu(300);
  cek(/ \/ 0:02$/.test(await pg.textContent('#pesanTime')), 'durasi pesan menampilkan batasnya', await pg.textContent('#pesanTime'));
  await tungguLayar('saving', 5000);
  cek(true, 'batas durasi tercapai: rekaman berhenti sendiri');
  await tungguLayar('thanks'); await pg.click('#btnCobaLagi');
  await pg.evaluate(() => { applySettings({ ...cfg, pesanMaxSeconds: 0 }); activeCouple.menu.quiz = true; terapkanMenu(); });
  await pg.click('#btnToQuiz');
  cek(/30 detik/.test(await pg.textContent('#quizInfo')), 'waktu jawab baru langsung dipakai quiz');
  await pg.click('#btnQuizBack');

  console.log('\n▶ Photo booth');
  await pg.click('#btnToPhoto');
  cek(/4 foto · hitung mundur 3 detik/.test(await pg.textContent('#pbIntro')), 'penjelasan Photo booth mengikuti hitung mundur 3 detik');
  await pg.evaluate(() => { window.KILAT = 0; new MutationObserver(() => { if (document.getElementById('pbFlash').classList.contains('on')) KILAT++; })
    .observe(document.getElementById('pbFlash'), { attributes: true }); });
  await pg.evaluate(() => { window.HITUNG = []; new MutationObserver(() => HITUNG.push(
      document.getElementById('pbCountNum').textContent + (document.getElementById('pbCount').classList.contains('kecil') ? 'k' : 'B')))
    .observe(document.getElementById('pbCountNum'), { childList: true }); });
  const t0 = Date.now();
  await pg.click('#pbStart'); await tunggu(700);
  const zona = await pg.evaluate(() => { const r = document.querySelector('#pbSafe .frame').getBoundingClientRect();
    return { on: document.getElementById('pbSafe').classList.contains('on'), w: r.width, h: r.height, x: r.left + r.width / 2, lebar: innerWidth }; });
  cek(zona.on && Math.abs(zona.w / zona.h - 1) < 0.02 && Math.abs(zona.x - zona.lebar / 2) < 2,
      'saat difoto: zona aman tampil di tengah sesuai rasio template (1:1)', zona);
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 });
  cek(!(await pg.evaluate(() => document.getElementById('pbSafe').classList.contains('on'))), 'setelah 4 foto selesai, zona aman disembunyikan');
  const lama = (Date.now() - t0) / 1000;
  cek(lama < 19, 'sesi 4 foto dengan hitung mundur 3 detik & tanpa pratinjau selesai lebih cepat', lama);
  cek(await pg.evaluate(() => KILAT) === 0, 'efek kilat mati sesuai pengaturan');
  const hitung = await pg.evaluate(() => HITUNG.join(' '));
  cek(hitung === '3B 2k 1k 3k 2k 1k 3k 2k 1k 3k 2k 1k', 'hitung mundur pertama besar lalu mengecil, foto 2-4 tetap kecil', hitung);
  await pg.evaluate(() => applySettings({ ...cfg, photoCountdown: 5, photoPreview: 2, photoFlash: true }));
  await pg.evaluate(() => { HITUNG.length = 0; });
  await pg.click('[data-redo="0"]'); await tunggu(5600);
  cek(await pg.evaluate(() => HITUNG.join(' ')) === '5k 4k 3k 2k 1k', 'hitung mundur saat Ulangi tetap kecil di pojok', await pg.evaluate(() => HITUNG.join(' ')));
  cek(await pg.isVisible('#pbPreview') && await pg.evaluate(() => KILAT) === 1, 'pratinjau & kilat aktif lagi setelah pengaturan dinyalakan');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 15000 });
  cek(await pg.locator('.pb-thumb.filled').count() === 4, '4 foto tampil berderet');
  cek(await pg.isVisible('[data-redo="1"]'), 'tombol Ulangi tampil di bawah foto');
  await pg.click('[data-redo="1"]'); await tunggu(500);
  cek(/Ulangi foto 2/.test(await pg.textContent('#pbPillText')) && !(await pg.isVisible('#pbFinish')), 'ulangi foto 2 berjalan');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 15000 });
  await pg.click('#pbFinish'); await tunggu(500);
  cek(await layar() === 'editphoto', 'Finish & edit membuka halaman Edit');
  cek(await pg.evaluate(() => document.querySelector('#peLayouts .pe-opt.on') === document.querySelector('#peLayouts .pe-opt'))
      && /Rustic emas/.test(await pg.textContent('#peLayouts .pe-opt')), 'template admin tampil pertama & langsung terpilih');
  cek(await pg.locator('#peLayouts .pe-opt').count() === 1, 'tamu tidak bisa memilih layout bawaan, hanya layout dari admin');
  cek(!(await pg.isVisible('[data-tab="layout"]')) && !(await pg.isVisible('[data-tab="frame"]')) && await pg.isVisible('#peFilters'),
      'hanya satu template: tab Layout & Bingkai disembunyikan, tamu langsung di tab Filter');
  await pg.click('[data-tab="filter"]'); await pg.locator('#peFilters .pe-opt').nth(1).click();
  await pg.click('[data-tab="sticker"]'); await pg.locator('#peStickerList .pe-stk').first().click();
  cek(await pg.locator('.pe-sticker').count() === 1, 'stiker bisa ditambahkan');
  await pg.click('#peDone'); await tungguLayar('thanks');
  const foto = await pg.evaluate(() => window.FOTO);
  cek(foto && foto.n === 4 && foto.meta.filter === 'bw' && foto.meta.stickers === 1 && foto.meta.template === 'Rustic emas', 'foto disimpan: 4 asli + hasil edit', foto);
  cek(await pg.textContent('#thanksMsg') === 'Fotomu sudah tersimpan.' && await pg.isVisible('#thanksPhoto'), 'Terima kasih menampilkan pratinjau foto');
  await pg.click('#btnCobaLagi'); await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai'); await tunggu(4300);
  await pg.click('#btnFinish'); await tungguLayar('thanks');
  cek(!(await pg.isVisible('#thanksPhoto')), 'setelah sesi video, pratinjau foto tidak ikut tampil');

  console.log('\n▶ Hapus template');
  await pg.evaluate(() => { show('admin'); }); await pg.locator('#coupleList .cp-row').first().click(); await tunggu(300);
  const hapus = pg.locator('#tplList .tpl-row button', { hasText: 'Hapus' });
  await hapus.click();
  cek(await pg.evaluate(() => TPL.length) === 1 && /Yakin/.test(await hapus.textContent()), 'hapus template minta ketuk dua kali');
  await pg.locator('#tplList .tpl-row button', { hasText: 'Yakin' }).click(); await tunggu(300);
  cek(await pg.evaluate(() => TPL.length) === 0 && /Belum ada template/.test(await pg.textContent('#tplList')), 'template terhapus dari daftar');
  await pg.evaluate(() => { applySettings({ ...cfg, photoCountdown: 3, photoPreview: 0 }); show('utama'); });
  await pg.click('#btnToPhoto'); await pg.click('#pbStart');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 }); await pg.click('#pbFinish'); await tunggu(500);
  cek(await pg.locator('#peLayouts .pe-opt').count() === 3 && await pg.isVisible('[data-tab="layout"]') && await pg.isVisible('[data-tab="frame"]'),
      'tanpa template: tamu memakai layout bawaan');
  await pg.click('#peDone'); await tungguLayar('thanks'); await pg.click('#btnCobaLagi');

  console.log('\n▶ Tambah couple baru lalu langsung buat template');
  await pg.evaluate(() => show('admin')); await pg.click('#btnAddCouple'); await tunggu(200);
  cek(await pg.isVisible('#cpTplBaru') && !(await pg.isVisible('#btnTplNew')) && !(await pg.isVisible('#btnDelCouple')), 'couple baru: template muncul setelah disimpan');
  await pg.fill('#fName', 'Sari & Andi'); await pg.click('#fActive'); await pg.click('#btnTambahSimpan'); await tunggu(300);
  cek(/Quick quiz aktif: isi minimal 1 pertanyaan/.test(await pg.textContent('#tambahErr')), 'Quick quiz aktif tanpa pertanyaan ditolak');
  await pg.click('#fMenuQuiz');
  cek(/Quick quiz mati/.test(await pg.textContent('#qWajib')), 'pertanyaan ditandai tidak dipakai saat Quick quiz mati');
  await pg.click('#btnTambahSimpan'); await tunggu(300);
  cek(await layar() === 'tambah' && await pg.isVisible('#btnTplNew') && await pg.textContent('#tambahTitle') === 'Sari & Andi',
      'setelah disimpan tetap di halaman couple & tombol Buat template muncul');
  cek(await pg.evaluate(() => CP.activeId) === 'a', 'couple aktif tidak berubah saat menyiapkan couple lain');
  await pg.click('#btnTplNew'); await tunggu(300);
  cek(/Sari & Andi/.test(await pg.textContent('#teTitle')) && await pg.evaluate(() => isiTeksTemplate('{couple}')) === 'Sari & Andi',
      'pratinjau {couple} memakai nama couple yang diedit');
  await pg.click('#teSimpan'); await tunggu(300);
  cek(await pg.evaluate(() => TPL.length === 1 && TPL[0].coupleId === 'n2'), 'template tersimpan untuk couple baru, bukan couple aktif');
  await pg.click('#btnCoupleFolder');
  cek((await log()).includes('folder n2'), 'Buka folder couple membuka folder couple yang diedit');
  await pg.click('#btnDelCouple');
  cek(await layar() === 'tambah' && /Yakin/.test(await pg.textContent('#delLabel')), 'hapus couple minta ketuk dua kali');
  await pg.click('#btnDelCouple'); await tunggu(300);
  cek(await layar() === 'admin' && await pg.locator('#coupleList .cp-row').count() === 2 && await pg.evaluate(() => TPL.length) === 0,
      'couple terhapus beserta templatenya');
  cek(/beserta 1 template/.test(await pg.textContent('#coupleMsg')), 'pesan menyebut template yang ikut terhapus');
  cek(await pg.evaluate(() => isiTeksTemplate('{couple}')) === 'Rina & Dimas', 'di luar halaman couple, {couple} kembali ke couple aktif');

  console.log('\n▶ Kamera Sony');
  await pg.evaluate(() => show('admin'));
  cek(await pg.inputValue('#camSumber') === 'webcam' && !(await pg.isVisible('#sonyRow')), 'Admin: sumber kamera bawaan Webcam / HP');
  await pg.selectOption('#camSumber', 'sony-sim'); await tunggu(400);
  cek(await pg.evaluate(() => document.body.classList.contains('sonyOn') && mediaStream === null), 'pilih Sony: webcam & mic komputer dilepas');
  cek(await pg.isVisible('#sonyRow') && !(await pg.isVisible('#camSelRow')) && /tersambung · baterai 100%/.test(await pg.textContent('#sonyStatus')),
      'status kamera Sony tampil, pilihan webcam disembunyikan', await pg.textContent('#sonyStatus'));
  cek(/mic ke jack mic kamera/.test(await pg.textContent('#camHint')), 'petunjuk mic & dummy battery tampil');
  await tunggu(400);
  cek(await pg.evaluate(() => document.getElementById('camPrevLv').width) === 640, 'live view tampil di pratinjau Admin');
  await pg.evaluate(() => { applySettings({ ...cfg, photoCountdown: 3, photoPreview: 0, pesanCountdown: 0 }); show('utama'); }); await tunggu(400);
  cek(await pg.isVisible('#camLv') && !(await pg.isVisible('#cam')), 'live view Sony jadi latar Halaman Utama');
  await pg.click('#btnToPhoto'); await pg.click('#pbStart');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 });
  cek(await pg.evaluate(() => SONY.foto) === 4 && await pg.locator('.pb-thumb.filled').count() === 4, 'photobooth memakai jepretan kamera Sony (4 foto)');
  await pg.click('#pbFinish'); await tunggu(500); await pg.click('#peDone'); await tungguLayar('thanks');
  const fs = await pg.evaluate(() => ({ foto: window.FOTO, besar: SONY.besar }));
  cek(fs.foto.n === 4 && fs.foto.asli.every(n => n === fs.besar), 'foto asli kamera disimpan utuh (tidak diperkecil)', fs);
  await pg.click('#btnCobaLagi'); await bersihkan();
  await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai'); await tunggu(400);
  cek((await log()).includes('start pesan sony'), 'Kirim pesan merekam lewat kamera Sony', await log());
  await pg.click('#btnFinish'); await tungguLayar('thanks');
  cek((await log()).some(x => /^end /.test(x)), 'rekaman Sony dihentikan & dicatat');
  await pg.click('#btnCobaLagi'); await bersihkan();
  await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai'); await tunggu(400);
  await pg.evaluate(() => setSony({ ...SONY.st, tersambung: false, pesan: 'Kamera Sony terputus.' })); await tunggu(400);
  cek(await layar() === 'utama' && /terputus saat merekam/.test(await pg.textContent('#notice')), 'kabel tercabut saat merekam: kembali ke Utama dengan pesan jelas');
  await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai'); await tunggu(200);
  cek(await layar() === 'pesan' && /belum tersambung/.test(await pg.textContent('#notice')), 'kamera belum tersambung: rekaman tidak dimulai');
  await pg.evaluate(() => { show('admin'); });
  await pg.selectOption('#camSumber', 'webcam'); await tunggu(500);
  cek(await pg.evaluate(() => !document.body.classList.contains('sonyOn') && !!mediaStream), 'kembali ke webcam: kamera komputer dibuka lagi');

  console.log('\n▶ Riwayat sesi');
  await pg.evaluate(() => {
    const t = (hari, h, m) => { const d = new Date(); d.setDate(d.getDate() - hari); d.setHours(h, m, 0, 0); return d.toISOString(); };
    window.SESI = [
      { id: 1, time: t(1, 19, 2), label: 'pesan', couple: 'Ayu & Budi', seconds: 48, status: 'done' },
      { id: 2, time: t(0, 18, 5), label: 'pesan', couple: 'Rina & Dimas', seconds: 42, status: 'done' },
      { id: 3, time: t(0, 18, 7), label: 'foto', couple: 'Rina & Dimas', status: 'photo', photos: 4 },
      { id: 4, time: t(0, 18, 12), label: 'quiz', couple: 'Rina & Dimas', seconds: 60, status: 'failed', questions: ['Kapan pertama bertemu?'] },
      { id: 5, time: t(0, 18, 20), label: 'pesan', couple: 'Rina & Dimas', seconds: 75, status: 'card-only', kamera: 'sony', kartu: 'C0005.MP4' },
      { id: 6, time: t(0, 18, 24), label: 'pesan', couple: 'Rina & Dimas', seconds: 1, status: 'done' },
      { id: 7, time: t(1, 18, 30), label: 'pesan', couple: 'Rina & Dimas', seconds: 30, status: 'done' },
    ];
    show('admin'); return loadSessions();
  });
  cek(/Rina & Dimas: 5 hari ini · 6 total/.test(await pg.textContent('#riwayatRingkas')) && (await pg.textContent('#riwayatBadge')) === '⚠️ 2',
      'Admin: ringkasan sesi couple aktif + jumlah yang perlu perhatian', await pg.textContent('#riwayatRingkas'));
  await pg.click('#btnRiwayat'); await tunggu(300);
  cek(await layar() === 'riwayat' && await pg.inputValue('#rwCouple') === 'Rina & Dimas', 'Riwayat sesi terbuka untuk couple aktif');
  cek((await pg.textContent('#rwRingkas')).replace(/\s/g, '') === '4Pesan1Quiz1Foto3Menitvideo', 'ringkasan jumlah pesan/quiz/foto & menit video', await pg.textContent('#rwRingkas'));
  const judulHari = await pg.locator('#rwList .group-title').allTextContents();
  cek(judulHari.length === 2 && /^Hari ini/.test(judulHari[0]) && /^Kemarin/.test(judulHari[1]), 'sesi dikelompokkan per hari (Hari ini, Kemarin)', judulHari);
  cek(await pg.locator('.rw-status.merah').count() === 1 && await pg.locator('.rw-status.oranye').count() === 1 && await pg.locator('.rw-status.hijau').count() === 4,
      'status berwarna: gagal merah, di kartu SD oranye, siap hijau');
  cek(/Terlalu pendek/.test(await pg.locator('.rw-row', { hasText: '18:24' }).textContent()), 'rekaman 1 detik ditandai "Terlalu pendek"');
  await pg.click('#rwBanner'); await tunggu(150);
  cek(await pg.locator('.rw-row').count() === 2, 'banner peringatan menampilkan 2 sesi bermasalah saja');
  await pg.locator('.rw-row', { hasText: 'Quiz' }).click(); await tunggu(150);
  cek(/gagal diubah ke MP4/.test(await pg.textContent('.rw-detail')) && /Kapan pertama bertemu/.test(await pg.textContent('.rw-detail')), 'detail sesi: keterangan & pertanyaan quiz');
  await bersihkan();
  await pg.locator('.rw-detail button', { hasText: 'Coba proses lagi' }).click(); await tunggu(400);
  cek((await log()).includes('ulang 4') && await pg.evaluate(() => SESI[3].status) === 'processing' && await pg.locator('.rw-row').count() === 1,
      'Coba proses lagi: sesi diproses ulang & keluar dari daftar "perlu perhatian"');
  await pg.click('#rwBanner'); await pg.locator('.rw-chip', { hasText: 'Foto' }).click();
  await pg.locator('.rw-row').first().click(); await pg.locator('.rw-detail button', { hasText: 'Lihat foto' }).click();
  await pg.locator('.rw-detail button', { hasText: 'Tampilkan di Finder' }).click(); await tunggu(100);
  cek((await log()).includes('buka 3') && (await log()).includes('finder 3'), 'foto bisa dibuka & ditampilkan di Finder');
  await pg.selectOption('#rwCouple', ''); await pg.locator('.rw-chip', { hasText: 'Semua' }).click(); await tunggu(100);
  cek(await pg.locator('.rw-row').count() === 7 && /Ayu & Budi/.test(await pg.textContent('#rwList')), 'pilihan "Semua couple" menampilkan semua sesi dengan nama couple');
  await pg.evaluate(() => { SESI.push({ id: 8, time: new Date().toISOString(), label: 'pesan', couple: 'Rina & Dimas', seconds: 20, status: 'transfer', kamera: 'sony' }); });
  await tunggu(3500);
  cek(await pg.locator('.rw-row').count() === 8, 'daftar diperbarui sendiri tanpa menekan Segarkan');
  await pg.click('#rwBack');
  cek(await layar() === 'admin', 'tombol Admin kembali');

  console.log('\n▶ Bahasa layar tamu');
  await pg.evaluate(() => show('admin'));
  cek(await pg.inputValue('#setBahasa') === 'id', 'bawaan: bahasa Indonesia');
  // Ganti bahasa tamu ke English
  await pg.selectOption('#setBahasa', 'en'); await tunggu(300);
  cek(/berbahasa Inggris/.test(await pg.textContent('#setMsg')) && /Tambah couple/.test(await pg.textContent('#btnAddCouple')) && /Riwayat sesi/.test(await pg.textContent('#btnRiwayat')),
      'halaman Admin tetap berbahasa Indonesia');
  await pg.click('#btnAdminBack'); await tunggu(200);
  cek(/Leave a message/.test(await pg.textContent('#btnToPesan')) && await pg.textContent('#welcome') === 'Tinggalkan pesan untuk kami' && await pg.locator('#btnToPesan svg').count() === 1,
      'Halaman Utama berbahasa Inggris (ikon tombol tetap ada); sambutan tampil seperti yang diketik');
  await pg.evaluate(() => { activeCouple.menu.quiz = true; terapkanMenu(); });
  await pg.click('#btnToQuiz');
  cek(/random questions/.test(await pg.textContent('#quizInfo')) && /Start quiz/.test(await pg.textContent('#btnQuizMulai')) && /Back/.test(await pg.textContent('#btnQuizBack')),
      'halaman Quiz berbahasa Inggris');
  cek(await pg.evaluate(() => cfg.quiz[0]) === 'Q satu', 'pertanyaan quiz tampil seperti yang diketik admin');
  await pg.click('#btnQuizBack'); await pg.click('#btnToPhoto');
  cek(/4 photos · \d+-second countdown before each/.test(await pg.textContent('#pbIntro')) && /Start/.test(await pg.textContent('#pbStart')), 'halaman Photo booth berbahasa Inggris');
  await pg.click('#pbStart');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 });
  cek(/Retake/.test(await pg.textContent('[data-redo="0"]')) && /Finish & edit/.test(await pg.textContent('#pbFinish')), 'tombol Retake & Finish & edit');
  await pg.click('#pbFinish'); await tunggu(500);
  cek(/Edit photo/.test(await pg.textContent('#editphoto h2')) && /Stickers/.test(await pg.textContent('[data-tab="sticker"]')), 'halaman Edit foto berbahasa Inggris');
  cek(await pg.evaluate(() => isiTeksTemplate('{tanggal}') === new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })),
      'tanggal di template foto ditulis dalam bahasa Inggris');
  await pg.click('#peDone'); await tungguLayar('thanks');
  cek(/Thank you/.test(await pg.textContent('#thanks h1')) && /Your photos have been saved/.test(await pg.textContent('#thanksMsg')) && /Try again/.test(await pg.textContent('#btnCobaLagi')),
      'halaman Terima kasih berbahasa Inggris');
  await pg.evaluate(() => show('admin')); await pg.selectOption('#setBahasa', 'id'); await tunggu(300);
  await pg.evaluate(() => show('utama'));
  cek(/Kirim pesan/.test(await pg.textContent('#btnToPesan')) && await pg.textContent('#welcome') === 'Tinggalkan pesan untuk kami', 'kembali ke bahasa Indonesia');

  console.log('\n▶ Unduh foto lewat QR');
  await pg.evaluate(() => { show('admin'); applySettings({ ...cfg, photoCountdown: 3, photoPreview: 0 }); });
  await pg.locator('#btnSetPhoto').scrollIntoViewIfNeeded(); await pg.click('#btnSetPhoto'); await tunggu(300);
  cek(!(await pg.isChecked('#setQrAktif')) && /QR mati/.test(await pg.textContent('#qrStatus')), 'Pengaturan photobooth: QR mati secara bawaan');
  await pg.click('#btnQrPasang'); await tunggu(200);
  cek(await pg.inputValue('#setQrUrl') === 'https://leura-foto.uji.workers.dev' && /tersimpan/.test(await pg.getAttribute('#setQrKunci', 'placeholder')),
      '"Ambil dari hasil pasang" mengisi alamat & kunci');
  await pg.click('#btnQrTes'); await tunggu(200);
  cek(/Tersambung ke server. Foto disimpan 7 hari/.test(await pg.textContent('#qrMsg')), 'Tes sambungan menampilkan hasil');
  await pg.click('#setQrAktif'); await tunggu(200);
  cek(await pg.evaluate(() => UNG.st.aktif) && /semua foto terkirim/.test(await pg.textContent('#qrStatus')), 'QR dinyalakan dari Admin');
  await pg.evaluate(() => UNG.cb({ ...UNG.st, menunggu: 2, errorTerakhir: 'Tidak ada internet / server tidak terjangkau' })); await tunggu(100);
  cek(/2 foto menunggu dikirim · Tidak ada internet/.test(await pg.textContent('#qrStatus')) && await pg.isVisible('#btnQrUlang'), 'status antrean tampil langsung, ada tombol "Coba kirim sekarang"');
  await bersihkan(); await pg.click('#btnQrUlang');
  cek((await log()).includes('unggah coba'), 'Coba kirim sekarang');
  await pg.evaluate(() => show('utama')); await pg.click('#btnToPhoto'); await pg.click('#pbStart');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 }); await pg.click('#pbFinish'); await tunggu(500);
  await pg.click('#peDone'); await tungguLayar('thanks');
  cek(await pg.isVisible('#thanksQR') && await pg.evaluate(() => document.getElementById('qrCanvas').width) > 200
      && await pg.textContent('#qrLink') === 'leura-foto.uji.workers.dev/f/Ab3dEf9hJk', 'halaman Terima kasih menampilkan QR + link');
  await pg.evaluate(() => { window.QRPNG = document.getElementById('qrCanvas').toDataURL('image/png'); });
  await pg.click('#btnCobaLagi'); await pg.click('#btnToPesan'); await pg.click('#btnPesanMulai'); await tunggu(400);
  await pg.click('#btnFinish'); await tungguLayar('thanks');
  cek(!(await pg.isVisible('#thanksQR')), 'setelah sesi video, QR foto tidak ikut tampil');
  require('fs').writeFileSync(require('path').join(require('os').tmpdir(), 'uji-qr.png'), Buffer.from((await pg.evaluate(() => QRPNG)).split(',')[1], 'base64'));
  await pg.click('#btnCobaLagi');

  console.log('\n▶ Link QR di Riwayat sesi');
  await pg.evaluate(() => {
    const jam = m => { const d = new Date(); d.setHours(17, m, 0, 0); return d.toISOString(); };
    SESI.push({ id: 20, time: jam(1), label: 'foto', couple: 'Rina & Dimas', status: 'photo', photos: 4, kode: 'Ab3dEf9hJk', link: 'https://leura-foto.uji.workers.dev/f/Ab3dEf9hJk', unggah: 'terkirim' },
              { id: 21, time: jam(2), label: 'foto', couple: 'Rina & Dimas', status: 'photo', photos: 4, kode: 'LamaKode99', unggah: 'menunggu' });
    show('admin');
  });
  await bersihkan(); await pg.click('#btnRiwayat'); await tunggu(400);
  await pg.click('.rw-row[data-id="20"]'); await tunggu(200);
  cek(await pg.textContent('.rw-detail .rw-link') === 'https://leura-foto.uji.workers.dev/f/Ab3dEf9hJk' && /foto sudah bisa diunduh/.test(await pg.textContent('.rw-detail')),
      'detail sesi foto menampilkan link unduh + status QR');
  await pg.click('.rw-detail button:has-text("Salin link")'); await tunggu(100);
  await pg.click('.rw-detail button:has-text("Buka link")'); await tunggu(100);
  const lg = await log();
  cek(lg.includes('salin https://leura-foto.uji.workers.dev/f/Ab3dEf9hJk') && lg.includes('buka https://leura-foto.uji.workers.dev/f/Ab3dEf9hJk') && /Link disalin/.test(await pg.textContent('#rwMsg')),
      'tombol Salin link & Buka link');
  await pg.click('.rw-detail button:has-text("Tampilkan QR")'); await tunggu(200);
  cek(await pg.isVisible('#rwQR canvas') && /leura-foto.uji.workers.dev\/f\/Ab3dEf9hJk/.test(await pg.textContent('#rwQR small')), 'Tampilkan QR: QR besar sesi itu muncul');
  await pg.evaluate(() => { window.QRPNG2 = document.querySelector('#rwQR canvas').toDataURL('image/png'); });
  require('fs').writeFileSync(require('path').join(require('os').tmpdir(), 'uji-qr-riwayat.png'), Buffer.from((await pg.evaluate(() => QRPNG2)).split(',')[1], 'base64'));
  await pg.click('#rwQR button'); await tunggu(100);
  cek(await pg.locator('#rwQR').count() === 0, 'QR besar ditutup');
  await pg.click('.rw-row[data-id="21"]'); await tunggu(200);
  cek(await pg.textContent('.rw-detail .rw-link') === 'https://leura-foto.uji.workers.dev/f/LamaKode99', 'sesi lama (hanya kode) tetap mendapat link dari alamat server');
  await pg.click('#rwBack'); await tunggu(200);

  console.log('\n▶ Tutup aplikasi dari Admin');
  await pg.evaluate(() => { show('admin'); $('adminLogin').style.display = 'none'; $('adminPanel').style.display = 'flex'; });
  await bersihkan();
  await pg.locator('#btnTutupApp').scrollIntoViewIfNeeded(); await pg.click('#btnTutupApp'); await tunggu(200);
  cek(await pg.isVisible('#dlgTutup') && (await pg.locator('#dlgTutup li').count()) === 0, 'tombol Tutup aplikasi meminta konfirmasi');
  await pg.click('#dlgTutupBatal'); await tunggu(100);
  cek(await pg.locator('#dlgTutup').count() === 0 && !(await log()).includes('tutup aplikasi'), 'Batal: aplikasi tidak ditutup');
  await pg.evaluate(() => { window.TUTUP = { salin: 1, proses: 0, foto: 2 }; });
  await pg.click('#btnTutupApp'); await tunggu(200);
  const peringatan = await pg.textContent('#dlgTutup ul');
  cek(/1 video masih disalin/.test(peringatan) && /2 foto QR belum terkirim/.test(peringatan) && !/diproses/.test(peringatan), 'peringatan video yang disalin & foto QR yang belum terkirim', peringatan);
  await pg.click('#dlgTutupYa'); await tunggu(200);
  cek((await log()).includes('tutup aplikasi') && /Menutup aplikasi/.test(await pg.textContent('#dlgTutup')), 'Ya: aplikasi ditutup lewat jalur resmi');
  await pg.evaluate(() => document.getElementById('dlgTutup').remove());

  console.log('\n▶ Tidak ada error di halaman');
  cek(errors.length === 0, 'tidak ada error JavaScript', errors);

  await browser.close();
  const h = hasil();
  console.log(`\n${h.gagal ? '✗' : '✓'} Uji tampilan: ${h.lulus} lulus, ${h.gagal} gagal`);
  process.exit(h.gagal ? 1 : 0);
}
main().catch(e => { console.log('Uji berhenti: ' + e.message); process.exit(1); });
