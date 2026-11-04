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
window.LOG = []; window.TPL = []; window.MODE = { startFail: false, mrThrow: false, endOk: true, endMs: 200 };
let nextId = 0, errCb = null;
window.fireRecError = id => errCb && errCb(id, 'ENOSPC: disk penuh');
const ST = { quizSeconds: 2, quizRounds: 2, kiosk: false, accent: '#b08d57', loginId: 'leura', pesanCountdown: 3, pesanMaxSeconds: 0,
  photoCountdown: 5, photoPreview: 2, photoFlash: true, enablePesan: true, enableQuiz: true, enablePhoto: true };
window.api = {
  getConfig: async () => ({ ...ST, welcome: '', colors: { accent: ST.accent } }),
  getCouples: async () => ({ activeId: 'a', couples: [
    { id: 'a', name: 'Rina & Dimas', welcome: 'Tinggalkan pesan untuk kami', questions: ['Q satu', 'Q dua', 'Q tiga'] },
    { id: 'b', name: 'Ayu & Budi', welcome: '', questions: ['Q'] }] }),
  login: async (id, pw) => pw === '1234',
  getSessions: async () => [{ time: new Date().toISOString(), label: 'pesan', couple: 'Rina & Dimas', seconds: 42, status: 'done' }],
  getOutDir: async () => ({ dir: '/Users/uji/Documents/VideoboothRecordings', isDefault: true, ok: true }),
  getSettings: async () => ({ ...ST }),
  saveSettings: async p => { LOG.push('setting ' + JSON.stringify(p));
    const next = { ...ST, ...p };   // sama seperti main/pengaturan.js: minimal satu menu tetap tampil
    if (!next.enablePesan && !next.enableQuiz && !next.enablePhoto) return { ...ST, error: 'Minimal satu menu harus tetap tampil di Halaman Utama.' };
    Object.assign(ST, p); return { ...ST }; },
  changeLogin: async (o, id) => o === '1234' ? { ok: true, id } : { error: 'Password lama salah.' },
  getStartupInfo: async () => ({ recovered: 0 }),
  recStart: async label => { LOG.push('start ' + label); return MODE.startFail ? { error: 'Folder penyimpanan tidak bisa ditulisi.' } : { id: ++nextId }; },
  recChunk: () => { LOG.push('chunk'); },
  recEnd: async (id, sec, meta) => { await new Promise(r => setTimeout(r, MODE.endMs)); LOG.push('end ' + id + (meta.aborted ? ' (batal)' : ''));
    return MODE.endOk ? { ok: true } : { ok: false, error: 'ENOSPC' }; },
  recAbort: async id => { LOG.push('abort ' + id); },
  onRecError: cb => { errCb = cb; },
  savePhotos: async p => { window.FOTO = { n: p.originals.length, result: p.result.length, meta: p.meta }; return { ok: true }; },
  listTemplates: async id => TPL.filter(t => t.coupleId === id).map(t => ({ ...t })),
  saveTemplate: async (t, g) => { window.SIMPAN_TPL = { t: JSON.parse(JSON.stringify(t)), bingkai: g.bingkai ? g.bingkai.length : g.bingkai };
    const lama = TPL.find(x => x.id === t.id) || {};
    let bingkaiUrl = lama.bingkaiUrl || null;
    if (g.bingkai) bingkaiUrl = 'data:image/png;base64,' + btoa(String.fromCharCode(...g.bingkai)); else if (g.bingkai === null) bingkaiUrl = null;
    const baru = { ...t, latarUrl: null, bingkaiUrl, diubah: Date.now() };
    const i = TPL.findIndex(x => x.id === t.id); if (i < 0) TPL.push(baru); else TPL[i] = baru;
    return { ok: true, template: baru }; },
  deleteTemplate: async id => { TPL.splice(TPL.findIndex(x => x.id === id), 1); return { ok: true }; },
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
  await pg.locator('.sw').nth(2).click(); await tunggu(200);
  cek(await pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()) === '#7C9A7E', 'warna langsung berubah');

  console.log('\n▶ Pengaturan videobooth');
  await pg.locator('#btnSetVideo').scrollIntoViewIfNeeded(); await pg.click('#btnSetVideo'); await tunggu(300);
  cek(await layar() === 'setvideo', 'halaman Pengaturan videobooth terbuka dari Admin');
  await pg.selectOption('#setSeconds', '30'); await tunggu(150);
  await pg.click('#setEnableQuiz'); await tunggu(150);
  await pg.selectOption('#setPesanCountdown', '0'); await tunggu(150);
  cek(/Hitung mundur pesan: langsung merekam/.test(await pg.textContent('#setVideoMsg')), 'konfirmasi tersimpan tampil');
  await pg.click('#btnSetVideoBack');
  cek(await layar() === 'admin', 'tombol Admin kembali ke halaman Admin');

  console.log('\n▶ Pengaturan photobooth');
  await pg.locator('#btnSetPhoto').scrollIntoViewIfNeeded(); await pg.click('#btnSetPhoto'); await tunggu(300);
  cek(await layar() === 'setphoto', 'halaman Pengaturan photobooth terbuka dari Admin');
  await pg.selectOption('#setPhotoCountdown', '3'); await pg.selectOption('#setPhotoPreview', '0'); await tunggu(150);
  await pg.click('#setPhotoFlash'); await tunggu(150);
  await pg.click('#setEnablePhoto'); await tunggu(150);
  await pg.evaluate(() => { document.getElementById('setEnablePesan').checked = false; document.getElementById('setEnablePesan').onchange({ target: { checked: false } }); });
  await tunggu(200);
  cek(/Minimal satu menu/.test(await pg.textContent('#setVideoMsg') + await pg.textContent('#setPhotoMsg')) && await pg.evaluate(() => cfg.enablePesan),
      'menu terakhir tidak bisa dimatikan');
  await pg.click('#setEnablePhoto'); await tunggu(150);

  console.log('\n▶ Editor template desain foto');
  cek(/Rina & Dimas/.test(await pg.textContent('#tplCouple')) && /Belum ada template/.test(await pg.textContent('#tplList')),
      'daftar template untuk couple aktif tampil (masih kosong)');
  await pg.click('#btnTplNew'); await tunggu(400);
  cek(await layar() === 'tpleditor' && await pg.locator('.te-slot').count() === 4, 'editor template terbuka dengan kotak foto 1-4');
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
  cek(await pg.evaluate(() => te.tpl.W === 600 && te.tpl.H === 1800 && te.tpl.slots.every(s => s.x + s.w <= 600)), 'ganti ukuran ke Strip: posisi ikut menyesuaikan');
  await pg.locator('#teUkuran .pe-opt').nth(0).click(); await tunggu(200);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await pg.setInputFiles('#teBingkaiFile', { name: 'bingkai.png', mimeType: 'image/png', buffer: png }); await tunggu(300);
  cek(/bingkai\.png/.test(await pg.textContent('#teBingkaiStatus')), 'bingkai PNG bisa diunggah');
  await pg.setInputFiles('#teBingkaiFile', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: png }); await tunggu(200);
  cek(/harus PNG/.test(await pg.textContent('#teMsg')), 'bingkai JPG ditolak dengan pesan jelas');
  await pg.click('#teSimpan'); await tunggu(400);
  const simpan = await pg.evaluate(() => window.SIMPAN_TPL);
  cek(await layar() === 'setphoto' && simpan.t.nama === 'Rustic emas' && simpan.t.coupleId === 'a' && simpan.bingkai === png.length,
      'template tersimpan untuk couple aktif beserta bingkainya', simpan && { nama: simpan.t.nama, bingkai: simpan.bingkai });
  cek(await pg.locator('#tplList .tpl-row').count() === 1 && /Rustic emas/.test(await pg.textContent('#tplList')), 'template tampil di daftar');
  await pg.locator('#tplList .tpl-row button', { hasText: 'Edit' }).click(); await tunggu(300);
  cek(await pg.inputValue('#teNama') === 'Rustic emas' && /bingkai/i.test(await pg.textContent('#teBingkaiStatus')), 'template bisa dibuka lagi untuk diedit');
  await pg.fill('#teNama', 'Rustic emas 2'); await pg.click('#teBatal');
  cek(await layar() === 'tpleditor' && /Buang/.test(await pg.textContent('#teBatal')), 'Batal dengan perubahan minta konfirmasi');
  await pg.click('#teBatal'); await tunggu(200);
  cek(await layar() === 'setphoto' && await pg.evaluate(() => TPL[0].nama) === 'Rustic emas', 'Batal tidak menyimpan perubahan');
  await pg.click('#btnSetPhotoBack'); await pg.click('#btnAdminBack');
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
  await pg.evaluate(() => applySettings({ ...cfg, pesanMaxSeconds: 0, enableQuiz: true }));
  await pg.click('#btnToQuiz');
  cek(/30 detik/.test(await pg.textContent('#quizInfo')), 'waktu jawab baru langsung dipakai quiz');
  await pg.click('#btnQuizBack');

  console.log('\n▶ Photo booth');
  await pg.click('#btnToPhoto');
  cek(/4 kali.*3 detik/.test(await pg.textContent('#pbIntro')), 'penjelasan Photo booth mengikuti hitung mundur 3 detik');
  await pg.evaluate(() => { window.KILAT = 0; new MutationObserver(() => { if (document.getElementById('pbFlash').classList.contains('on')) KILAT++; })
    .observe(document.getElementById('pbFlash'), { attributes: true }); });
  const t0 = Date.now();
  await pg.click('#pbStart');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 });
  const lama = (Date.now() - t0) / 1000;
  cek(lama < 19, 'sesi 4 foto dengan hitung mundur 3 detik & tanpa pratinjau selesai lebih cepat', lama);
  cek(await pg.evaluate(() => KILAT) === 0, 'efek kilat mati sesuai pengaturan');
  await pg.evaluate(() => applySettings({ ...cfg, photoCountdown: 5, photoPreview: 2, photoFlash: true }));
  await pg.click('[data-redo="0"]'); await tunggu(5600);
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
  cek(await pg.locator('#peLayouts .pe-opt').count() === 4, 'layout bawaan tetap tersedia di bawah template');
  await pg.click('[data-tab="frame"]');
  cek(await pg.isVisible('#peFrameHint') && !(await pg.isVisible('#peFrames')), 'tab Bingkai menjelaskan bahwa template sudah punya bingkai');
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
  await pg.evaluate(() => { show('admin'); }); await pg.locator('#btnSetPhoto').scrollIntoViewIfNeeded(); await pg.click('#btnSetPhoto'); await tunggu(300);
  const hapus = pg.locator('#tplList .tpl-row button', { hasText: 'Hapus' });
  await hapus.click();
  cek(await pg.evaluate(() => TPL.length) === 1 && /Yakin/.test(await hapus.textContent()), 'hapus template minta ketuk dua kali');
  await pg.locator('#tplList .tpl-row button', { hasText: 'Yakin' }).click(); await tunggu(300);
  cek(await pg.evaluate(() => TPL.length) === 0 && /Belum ada template/.test(await pg.textContent('#tplList')), 'template terhapus dari daftar');

  console.log('\n▶ Tidak ada error di halaman');
  cek(errors.length === 0, 'tidak ada error JavaScript', errors);

  await browser.close();
  const h = hasil();
  console.log(`\n${h.gagal ? '✗' : '✓'} Uji tampilan: ${h.lulus} lulus, ${h.gagal} gagal`);
  process.exit(h.gagal ? 1 : 0);
}
main().catch(e => { console.log('Uji berhenti: ' + e.message); process.exit(1); });
