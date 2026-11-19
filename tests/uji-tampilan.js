/* =====================================================================
   uji-tampilan.js — uji tampilan: membuka index.html di browser dengan
   kamera palsu dan "api" palsu, lalu menekan tombol seperti tamu.
   Jalankan:  node tests/uji-tampilan.js        (butuh paket playwright)
   Pemasangan sekali:  npm install --save-dev playwright && npx playwright install chromium
   ===================================================================== */
const path = require('path');
let playwright;
try {
  playwright = require('playwright');
} catch {
  console.log(
    'Paket "playwright" belum terpasang. Pasang sekali dengan:\n' +
      '  npm install --save-dev playwright\n  npx playwright install chromium',
  );
  process.exit(1);
}
const { cek: check, hasil } = require('./bantu');
// The first failed check also saves evidence (the page as it is at that moment)
let evidenceSaved = null;
const cek = (ok, ...rest) => {
  const r = check(ok, ...rest);
  if (!ok && !evidenceSaved) evidenceSaved = saveEvidence('first failed check');
  return r;
};
const { startStaticServer } = require('./static-server');

// When the test stops or a check fails: screenshot + what the page shows, so a failure on GitHub can be
// understood without the computer (uji.yml uploads tests/hasil-uji/ as an artifact).
let evidencePage = null;
const pageErrors = [];
async function saveEvidence(reason) {
  if (!evidencePage) return;
  try {
    const dir = path.join(__dirname, 'hasil-uji');
    require('fs').mkdirSync(dir, { recursive: true });
    await evidencePage.screenshot({
      path: path.join(dir, `tampilan-${reason.replace(/\W+/g, '-')}.png`),
      timeout: 5000,
    });
    const info = await evidencePage.evaluate(() => ({
      screen: document.querySelector('.screen.on')?.id,
      busy: window.__leura?.state?.busy,
      log: (window.LOG || []).filter(x => x !== 'chunk').slice(-15),
      text: (document.querySelector('.screen.on')?.innerText || '').slice(0, 300),
      now: Math.round(performance.now()),
      screens: window.SCREEN_HISTORY,
    }));
    console.log('Evidence (' + reason + '): ' + JSON.stringify({ ...info, pageErrors }));
  } catch (e) {
    console.log('Evidence could not be saved: ' + e.message);
  }
}

// Dipasang di halaman sebelum aplikasi berjalan: kamera palsu + api palsu yang mencatat panggilan
const PALSU = `
window.LOG = []; window.TPL = [];
window.UNG = { st: { enabled: false, url: '', hasKey: false, video: true, videoQuality: '720', waiting: 0, waitingVideos: 0, sent: 0, lastError: '', hasSetupResult: true }, cb: null };
// Kamera Sony tiruan (proses utama aslinya diuji di uji-utama.js)
window.SONY = { st: { mode: 'webcam', connected: false, message: '' }, cb: null, photos: 0, besar: 0 };
window.buatJpeg = async (w, h, warna) => { const c = new OffscreenCanvas(w, h); const g = c.getContext('2d');
  g.fillStyle = warna; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(w / 4, h / 4, w / 2, h / 2);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer()); };
window.setSony = st => { SONY.st = st; setTimeout(() => SONY.cb && SONY.cb(st), 30); };
window.CP = { activeId: 'a', couples: [
  { id: 'a', name: 'Rina & Dimas', welcome: 'Tinggalkan pesan untuk kami', questions: ['Q satu', 'Q dua', 'Q tiga'] },
  { id: 'b', name: 'Ayu & Budi', welcome: '', questions: ['Q'] }] }; window.MODE = { startFail: false, mrThrow: false, endOk: true, endMs: 200 };
let nextId = 0, errCb = null;
window.fireRecError = id => errCb && errCb(id, 'ENOSPC: disk penuh');
const ST = { quizSeconds: 2, quizRounds: 2, kiosk: false, fullscreen: false, accent: '#b08d57', loginId: 'leura', messageCountdown: 3, messageMaxSeconds: 0,
  photoCountdown: 5, photoPreview: 2, photoFlash: true, enableMessage: true, enableQuiz: true, enablePhoto: true, language: 'id',
  printEnabled: false, printMaxCopies: 4, printer: '' };
window.api = {
  getConfig: async () => ({ ...ST, welcome: '', colors: { accent: ST.accent } }),
  getCouples: async () => JSON.parse(JSON.stringify(CP)),
  saveCouple: async c => { const q = c.questions.map(x => x.trim()).filter(Boolean);
    if (!c.name.trim()) return { error: 'Please enter the couple\\'s name.' };
    if (!Object.values(c.menu).some(Boolean)) return { error: 'At least one option must be on.' };
    if (c.menu.quiz && !q.length) return { error: 'Quick quiz is on: add at least 1 question, or turn Quick quiz off.' };
    const baru = { id: c.id || 'n' + CP.couples.length, name: c.name.trim(), welcome: c.welcome, questions: q, menu: c.menu };
    const i = CP.couples.findIndex(x => x.id === baru.id); if (i < 0) CP.couples.push(baru); else CP.couples[i] = baru;
    return { ok: true, couple: baru, data: JSON.parse(JSON.stringify(CP)) }; },
  setActiveCouple: async id => { CP.activeId = id; return { ok: true, data: JSON.parse(JSON.stringify(CP)) }; },
  deleteCouple: async id => { CP.couples = CP.couples.filter(c => c.id !== id); if (CP.activeId === id) CP.activeId = CP.couples[0].id;
    const n = TPL.filter(t => t.coupleId === id).length; TPL = TPL.filter(t => t.coupleId !== id);
    return { ok: true, data: JSON.parse(JSON.stringify(CP)), templatesDeleted: n }; },
  countTemplates: async () => TPL.reduce((n, t) => (n[t.coupleId] = (n[t.coupleId] || 0) + 1, n), {}),
  login: async (id, pw) => pw === '1234',
  getSessions: async () => window.SESI || [{ time: new Date().toISOString(), label: 'message', couple: 'Rina & Dimas', seconds: 42, status: 'done' }],
  sessionOpen: async id => { LOG.push('buka ' + id); return { ok: true }; },
  sessionReveal: async id => { LOG.push('finder ' + id); return { ok: true }; },
  sessionThumb: async id => { window.NTHUMB = (window.NTHUMB || 0) + 1; return window.THUMB_URL || null; },
  sessionRetry: async id => { LOG.push('ulang ' + id); const s = SESI.find(x => x.id === id); s.status = s.status === 'card-only' ? 'transfer' : 'processing'; return { ok: true }; },
  getOutDir: async () => ({ dir: '/Users/uji/Documents/VideoboothRecordings', isDefault: true, ok: true }),
  diskSpace: async () => MODE.disk || { ok: true, dir: '/Users/uji/Documents/VideoboothRecordings', free: 200 * 1024 ** 3, total: 500 * 1024 ** 3, level: 'ok' },
  getSettings: async () => ({ ...ST }),
  sonyStatus: async () => SONY.st,
  onSonyStatus: cb => { SONY.cb = cb; },
  sonyReconnect: async () => SONY.st,
  sonyLiveView: async () => SONY.st.connected ? buatJpeg(640, 424, '#336') : null,
  sonyMode: async j => { LOG.push('mode ' + j); const beda = !!SONY.st.modeKind && SONY.st.modeKind !== j; if (beda) await new Promise(r => setTimeout(r, window.MODE_DELAY || 0)); SONY.st = { ...SONY.st, modeKind: j }; return { ok: true, kind: j, changed: beda }; },
  sonyPhoto: async () => { SONY.photos++; const b = await buatJpeg(3600, 2400, '#a64'); SONY.besar = b.length; return { ok: true, bytes: b }; },
  saveSettings: async p => { LOG.push('setting ' + JSON.stringify(p));
    if (p.camera) setSony(p.camera === 'webcam' ? { mode: 'webcam', connected: false, message: '' }
      : { mode: p.camera, connected: true, model: 'ILCE-6700 (simulasi)', battery: 100, cardError: 0, recordSecondsLeft: 9000, message: '' });
    const next = { ...ST, ...p };   // sama seperti main/settings.js: minimal satu menu tetap tampil
    if (!next.enableMessage && !next.enableQuiz && !next.enablePhoto) return { ...ST, error: 'At least one option must stay on the main menu.' };
    Object.assign(ST, p); return { ...ST }; },
  changeLogin: async (o, id) => o === '1234' ? { ok: true, id } : { error: 'Current password is wrong.' },
  getStartupInfo: async () => ({ recovered: 0 }),
  appInfo: async () => ({ version: '1.0.0', installed: false, branch: 'chore/mac-installer', licenses: true }),
  openLicenses: async () => { LOG.push('lisensi'); return { ok: true }; },
  recStart: async (label, o) => { window.TAMU_REC = o && o.guest; LOG.push('start ' + label + (o && o.sony ? ' sony' : '')); return MODE.startFail ? { error: 'The storage folder is not writable.' } : { id: ++nextId }; },
  recChunk: () => { LOG.push('chunk'); },
  recEnd: async (id, sec, meta) => { await new Promise(r => setTimeout(r, MODE.endMs)); LOG.push('end ' + id + (meta.aborted ? ' (batal)' : '')); window.META_REC = meta;
    return MODE.endOk ? { ok: true, ...(MODE.qrVideo ? { link: 'https://leura-foto.uji.workers.dev/v/Vid3oKode1', code: 'Vid3oKode1' } : {}) } : { ok: false, error: 'ENOSPC' }; },
  recAbort: async id => { LOG.push('abort ' + id); },
  onRecError: cb => { errCb = cb; },
  savePhotos: async p => { window.FOTO = { guest: p.guest, n: p.originals.length, result: p.result.length, meta: p.meta, asli: p.originals.map(o => o.length) };
    return UNG.st.enabled ? { ok: true, link: 'https://leura-foto.uji.workers.dev/f/Ab3dEf9hJk', code: 'Ab3dEf9hJk' } : { ok: true, link: null }; },
  // One QR per guest (main/upload.js → guestQr): one result = its own link, several = the guest page
  guestQr: async (items, couple) => { window.GQ = { items, couple }; if (!items.length) return null;
    const u = 'https://leura-foto.uji.workers.dev/';
    if (items.length === 1) return { link: u + (items[0].kind === 'video' ? 'v/' : 'f/') + items[0].code, count: 1 };
    return { link: u + 't/Gu3stKode1', count: items.length }; },
  uploadStatus: async () => ({ ...UNG.st }),
  saveUploadSettings: async p => { LOG.push('unggah ' + JSON.stringify(p)); Object.assign(UNG.st, p.url != null ? { url: p.url } : {}, p.key ? { hasKey: true } : {}, p.enabled != null ? { enabled: p.enabled } : {}, p.video != null ? { video: p.video } : {}, p.videoQuality ? { videoQuality: p.videoQuality } : {}); return { ...UNG.st }; },
  testUpload: async () => ({ ok: true, days: 7 }),
  uploadSetupResult: async () => ({ url: 'https://leura-foto.uji.workers.dev', key: 'abc123' }),
  retryUploadNow: async () => { LOG.push('unggah coba'); return { ...UNG.st }; },
  onUploadStatus: cb => { UNG.cb = cb; },
  readLog: async () => ({ file: '2026-11-06', text: '15:01:02   Aplikasi dibuka\\n15:02:10 ✗ Kamera Sony gagal tersambung (0x8208)\\n' }),
  saveLog: async () => { LOG.push('simpan catatan'); return { ok: true, file: '/Users/x/Downloads/Leura-catatan-2026-11-06.txt' }; },
  log: () => {},
  onQuitRequest: cb => { window.MINTA_TUTUP = cb; },
  checkQuit: async () => (window.TUTUP || { copying: 0, processing: 0, photos: 0 }),
  quitApp: async () => { LOG.push('tutup aplikasi'); return { ok: true }; },
  openLink: async u => { LOG.push('buka ' + u); return { ok: true }; },
  copyText: async t => { LOG.push('salin ' + t); return { ok: true }; },
  listTemplates: async id => TPL.filter(t => t.coupleId === id).map(t => ({ ...t })),
  saveTemplate: async (t, g) => { window.SIMPAN_TPL = { t: JSON.parse(JSON.stringify(t)), frame: g.frame ? g.frame.length : g.frame };
    const lama = TPL.find(x => x.id === t.id) || {};
    let bingkaiUrl = lama.frameUrl || null;
    if (g.frame) bingkaiUrl = 'data:image/png;base64,' + btoa(String.fromCharCode(...g.frame)); else if (g.frame === null) bingkaiUrl = null;
    const baru = { ...t, backgroundUrl: null, frameUrl: bingkaiUrl, changed: Date.now() };
    const i = TPL.findIndex(x => x.id === t.id); if (i < 0) TPL.push(baru); else TPL[i] = baru;
    return { ok: true, template: baru }; },
  deleteTemplate: async id => { TPL.splice(TPL.findIndex(x => x.id === id), 1); return { ok: true }; },
  listFilters: async () => (window.FLT || []).map(f => ({ id: f.id, name: f.name, size: f.size })),
  addFilter: async (nama, bytes) => {
    const teks = new TextDecoder().decode(bytes);
    let lut; try { lut = window.__leura.parseCube(teks); } catch (e) { return { error: 'This file can\\'t be used: ' + e.message }; }
    const f = { id: 'lut' + ((window.FLT || []).length + 1), name: nama.replace(/\\.cube$/i, ''), size: lut.size, text: teks };
    (window.FLT = window.FLT || []).push(f); return { ok: true, filter: { id: f.id, name: f.name, size: f.size } };
  },
  getFilter: async id => { const f = (window.FLT || []).find(x => x.id === id); return f ? { ...f } : null; },
  renameFilter: async () => ({ ok: true }),
  deleteFilter: async id => { window.FLT = (window.FLT || []).filter(x => x.id !== id); return { ok: true }; },
  // Printing (main/print.js is tested in uji-utama.js)
  printPrinters: async () => [{ name: 'DNP DS620', displayName: 'DNP DS620', isDefault: true }],
  printPhoto: async p => { window.CETAK = { copies: p.copies, layout: p.layout, guest: p.guest, image: p.image }; LOG.push('cetak ' + p.copies); return { ok: true, id: 1 }; },
  printStatus: async () => ({ printer: ST.printer || '', waiting: 0, failed: 0, printedToday: 0, sheetsToday: 0, lastError: '' }),
  printRetry: async () => ({ retried: 0 }), printClearFailed: async () => ({ removed: 0 }),
  printTest: async () => { LOG.push('tes cetak'); return { ok: true }; }, onPrintStatus: () => {},
  printSessionSource: async id => ({ image: await buatJpeg(1200, 1800, '#a64') }),
  albumStatus: async () => ({ sessions: 3, made: null, newSince: 0, processing: 1 }),
  createAlbum: async (id, o) => { LOG.push('album ' + (o && o.anyway ? 'anyway' : 'ask'));
    return o && o.anyway ? { ok: true, sessions: 3, made: Date.now(), newSince: 0, processing: 1 } : { needsConfirm: true, processing: 1 }; },
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
  const server = await startStaticServer(path.join(__dirname, '..'));
  const HALAMAN = server.url + 'index.html';
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const pg = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = pageErrors;
  pg.on('pageerror', e => errors.push(e.message));
  evidencePage = pg;
  await pg.addInitScript(PALSU);
  // Evidence: every screen change with the code that asked for it (show() toggles "on" on each .screen)
  await pg.addInitScript(() => {
    window.SCREEN_HISTORY = [];
    const toggle = DOMTokenList.prototype.toggle;
    DOMTokenList.prototype.toggle = function (name, force) {
      const el = this._owner;
      const result = toggle.call(this, name, force);
      if (name === 'on' && force === true && el && el.classList.contains('screen')) {
        const last = window.SCREEN_HISTORY.at(-1);
        if (!last || last.id !== el.id) {
          const at = (new Error().stack || '')
            .split('\n')
            .slice(4, 9)
            .map(l =>
              l
                .trim()
                .replace(/^at /, '')
                .replace(/https?:\/\/[^/]+\//, ''),
            )
            .join(' < ');
          window.SCREEN_HISTORY.push({ t: Math.round(performance.now()), id: el.id, at });
          if (window.SCREEN_HISTORY.length > 12) window.SCREEN_HISTORY.shift();
        }
      }
      return result;
    };
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'classList');
    Object.defineProperty(Element.prototype, 'classList', {
      get() {
        const list = desc.get.call(this);
        list._owner = this;
        return list;
      },
    });
  });
  await pg.goto(HALAMAN);
  await pg.waitForTimeout(800);
  // The tests click faster than any guest: no waiting after Start (the wait itself is tested further down)
  const tanpaJeda = () =>
    pg.evaluate(() => {
      __leura.state.arrivalGuardMs = 0;
    });
  await tanpaJeda();
  const layar = () => pg.evaluate(() => document.querySelector('.screen.on').id);
  const log = () => pg.evaluate(() => LOG.filter(x => x !== 'chunk'));
  const bersihkan = () =>
    pg.evaluate(() => {
      LOG.length = 0;
    });
  const atur = m => pg.evaluate(m => Object.assign(MODE, m), m);
  const tunggu = ms => pg.waitForTimeout(ms);
  const tungguLayar = (id, ms = 20000) => pg.waitForSelector('#' + id + '.on', { timeout: ms });
  // Terima kasih kembali sendiri ke menu; ketuk layarnya supaya langsung kembali (dengan animasi keluar)
  // A slow machine (GitHub Windows) can stall past the 4.5 s auto-return: then the page has already left by
  // itself. So tap only if it is still showing, in one step inside the page (no gap for a race).
  const keMenu = async () => {
    await pg.evaluate(() => {
      if (__leura.state.current === 'thanks') document.getElementById('thanks').click();
    });
    await tungguLayar('home');
  };

  console.log('\n▶ Halaman awal');
  cek((await layar()) === 'start', 'aplikasi dibuka di halaman Start');
  await pg.click('#btnStart');
  cek(
    (await layar()) === 'name' && (await pg.isVisible('#nameKeyboard .kb-key')),
    'Start membuka halaman "Siapa namamu?" dengan keyboard layar',
  );
  cek(await pg.isDisabled('#nameKeyboard [data-k="enter"]'), 'tombol Lanjut mati selama nama masih kosong');
  const ketik = async ks => {
    for (const k of ks) await pg.click(`#nameKeyboard [data-k="${k}"]`);
  };
  await ketik(['b', 'u', 'd', 'i', 'spasi', 's', '⌫', 'a', 'r', 'i']);
  cek(
    (await pg.inputValue('#nameInput')) === 'Budi Ari',
    'keyboard layar: huruf besar otomatis di awal kata, spasi, hapus',
    await pg.inputValue('#nameInput'),
  );
  await ketik(['123', '2', 'ABC']);
  cek((await pg.inputValue('#nameInput')) === 'Budi Ari2', 'keyboard layar: tombol 123 untuk angka');
  await ketik(['⌫']);
  await pg.click('#nameKeyboard [data-k="enter"]');
  cek(
    (await layar()) === 'home' && (await pg.textContent('#couple')) === 'Rina & Dimas',
    'Halaman Utama menampilkan couple aktif',
  );
  cek(
    (await pg.textContent('#guestGreeting')) === 'Hai, Budi Ari!' && (await pg.isVisible('#guestGreeting')),
    'Halaman Utama menyapa tamu dengan namanya',
  );
  cek(await pg.isVisible('#btnToPhoto'), 'tombol Photo booth ada di Halaman Utama');

  console.log('\n▶ Kirim pesan');
  await bersihkan();
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(4300);
  await pg.click('#btnFinish');
  await tunggu(500);
  cek((await layar()) === 'saving', 'setelah Selesai muncul layar Menyimpan');
  cek((await pg.evaluate(() => window.TAMU_REC)) === 'Budi Ari', 'nama tamu ikut dikirim untuk nama file rekaman');
  await tungguLayar('thanks');
  cek((await pg.textContent('#thanksMsg')) === 'Rekamanmu sudah tersimpan.', 'Terima kasih: rekaman tersimpan');
  cek(JSON.stringify(await log()) === '["start message","end 1"]', 'satu rekaman dimulai dan disimpan', await log());
  cek(
    (await pg.locator('#thanks button').count()) === 0 && (await pg.locator('#thanks canvas').count()) === 0,
    'Terima kasih: tanpa tombol dan tanpa QR',
  );
  const animasi = await pg.evaluate(() => {
    const side = getComputedStyle(document.querySelector('#thanks .thanks-side')).animationName;
    const bar = getComputedStyle(document.querySelector('#thanks .thanks-timer i')).animationName;
    return side + ' ' + bar + ' ' + getComputedStyle(document.getElementById('thanks')).getPropertyValue('--thanks-ms');
  });
  cek(
    /thanksIn thanksTimer 4500ms/.test(animasi),
    'Terima kasih masuk dengan animasi + garis waktu 4,5 detik',
    animasi,
  );
  // The leaving animation only lasts ±0.5 s: on a slow computer (GitHub Windows) it can be over before the test
  // looks, so it is recorded while it happens instead of waited for
  await pg.evaluate(() => {
    const t = document.getElementById('thanks');
    window.__sawLeaving = false;
    new MutationObserver(() => {
      if (t.classList.contains('leaving')) window.__sawLeaving = true;
    }).observe(t, { attributes: true, attributeFilter: ['class'] });
  });
  await tunggu(4200);
  cek((await layar()) === 'thanks', 'Terima kasih masih tampil sebelum 4,5 detik');
  await tungguLayar('home', 3000);
  cek(await pg.evaluate(() => window.__sawLeaving), 'Terima kasih keluar dengan animasi sebelum menu');
  cek(
    await pg.evaluate(
      () =>
        document.getElementById('home').classList.contains('enter') &&
        getComputedStyle(document.querySelector('#home .home-menu')).animationName === 'homeIn',
    ),
    'Terima kasih kembali sendiri ke menu dengan animasi (keluar lalu menu naik)',
  );
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageBack');
  cek(
    !(await pg.evaluate(() => document.getElementById('home').classList.contains('enter'))),
    'animasi menu hanya setelah Terima kasih',
  );
  await pg.evaluate(() => __leura.show('thanks'));

  console.log('\n▶ Rekaman gagal dimulai tidak membuat layar macet');
  await atur({ startFail: true });
  await keMenu();
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(3600);
  cek(
    (await layar()) === 'home' && /not writable/.test(await pg.textContent('#notice')),
    'folder tidak bisa ditulisi: kembali ke Utama dengan pesan',
  );
  await atur({ startFail: false, mrThrow: true });
  await bersihkan();
  await pg.click('#btnToQuiz');
  await pg.click('#btnQuizStart');
  await tunggu(500);
  cek(
    (await layar()) === 'home' && (await log()).includes('abort 2'),
    'perekam gagal dibuat: rekaman dibatalkan & kembali ke Utama',
    await log(),
  );
  await atur({ mrThrow: false });

  console.log('\n▶ Disk penuh di tengah rekaman');
  await bersihkan();
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(4500);
  await pg.evaluate(() => fireRecError(__leura.state.rec.id));
  await tunggu(600);
  cek(
    (await layar()) === 'home' && /disk/.test(await pg.textContent('#notice')),
    'kembali ke Utama dengan pesan cek disk',
  );
  cek(
    (await log()).some(x => x.endsWith('(batal)')),
    'bagian yang sempat terekam tetap disimpan',
  );

  console.log('\n▶ Quiz + Coba lagi cepat');
  await bersihkan();
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(4300);
  await pg.click('#btnFinish');
  await tungguLayar('thanks');
  await keMenu();
  await pg.click('#btnToQuiz');
  cek(/2 pertanyaan acak · 2 detik/.test(await pg.textContent('#quizInfo')), 'info quiz mengikuti pengaturan');
  await pg.click('#btnQuizStart');
  await tungguLayar('thanks', 30000);
  const L = await log();
  cek(
    L.indexOf('end 4') < L.indexOf('start quiz') && L.includes('end 5'),
    'rekaman lama tersimpan sebelum rekaman baru dimulai',
    L,
  );

  console.log('\n▶ Quiz: hitung mundur, teks pertanyaan & QR video');
  await atur({ qrVideo: true });
  await bersihkan();
  await keMenu();
  await pg.click('#btnToQuiz');
  await pg.click('#btnQuizStart');
  await tunggu(500);
  cek(
    (await pg.isVisible('#countOverlay')) && (await log()).includes('start quiz') && !(await pg.isVisible('#quizRun')),
    'quiz: hitung mundur dulu, dan kamera sudah merekam sejak awal hitung mundur',
    await log(),
  );
  await tungguLayar('thanks', 30000);
  const mq = await pg.evaluate(() => ({
    k: META_REC.captions,
    q: META_REC.questions,
    g: (META_REC.captionImages || []).map(x => [x.length, x[0], x[1]]),
  }));
  cek(
    mq.k &&
      mq.k.length === 2 &&
      mq.k[0].a >= 2.8 &&
      mq.k[0].b > mq.k[0].a &&
      mq.k[1].a >= mq.k[0].b &&
      mq.k.every((k, i) => k.title === mq.q[i]),
    'waktu tampil tiap pertanyaan dicatat (setelah hitung mundur 3 detik)',
    mq.k,
  );
  cek(
    mq.g.length === 2 && mq.g.every(x => x[0] > 1000 && x[1] === 137 && x[2] === 80),
    'teks tiap pertanyaan digambar sebagai PNG untuk ditempel di video',
    mq.g,
  );
  require('fs').writeFileSync(
    require('path').join(require('os').tmpdir(), 'uji-kapsi.png'),
    Buffer.from(
      await pg.evaluate(async () => {
        const b = new Uint8Array(META_REC.captionImages[0]);
        let s = '';
        for (const x of b) s += String.fromCharCode(x);
        return btoa(s);
      }),
      'base64',
    ),
  );
  cek(
    !(await pg.isVisible('#qrCanvas')) &&
      JSON.stringify(await pg.evaluate(() => __leura.state.guestResults)) ===
        '[{"kind":"video","code":"Vid3oKode1","label":"quiz"}]',
    'Terima kasih tanpa QR; kode video quiz disimpan untuk QR tamu',
  );
  await keMenu();
  cek(
    await pg.evaluate(() => {
      const b = document.getElementById('btnGuestDone');
      const r = b.getBoundingClientRect();
      return b.classList.contains('with-qr') && b.textContent.trim() === 'Selesai & ambil QR' && r.height >= 70;
    }),
    'menu: tombol besar "Selesai & ambil QR"',
  );
  await pg.click('#btnGuestDone');
  await tungguLayar('guestQr');
  cek(
    (await pg.textContent('#qrLink')) === 'leura-foto.uji.workers.dev/v/Vid3oKode1' &&
      (await pg.textContent('#gqSummary')) === '1 video quiz' &&
      (await pg.evaluate(() => document.getElementById('qrCanvas').width)) > 200,
    'satu hasil: QR langsung ke halaman videonya',
  );
  await pg.click('#btnGuestQrDone');
  cek(
    (await layar()) === 'start' && (await pg.evaluate(() => __leura.state.guestResults.length)) === 0,
    'Selesai di halaman QR: kembali ke Start, daftar hasil tamu kosong lagi',
  );
  await atur({ qrVideo: false });
  await pg.evaluate(() => __leura.show('home'));
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(4300);
  await pg.click('#btnFinish');
  await tungguLayar('thanks');
  cek(
    (await pg.evaluate(() => __leura.state.guestResults.length)) === 0 && !(await pg.evaluate(() => META_REC.captions)),
    'pesan video tanpa QR (QR video mati): tidak ada kode QR, tidak ada teks pertanyaan',
  );

  console.log('\n▶ Halaman Terima kasih mengikuti hasil penyimpanan');
  await atur({ endOk: false });
  await keMenu();
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(4300);
  await pg.click('#btnFinish');
  await tungguLayar('thanks');
  cek(/belum berhasil/.test(await pg.textContent('#thanksMsg')), 'gagal simpan: pesan "belum berhasil tersimpan"');
  await atur({ endOk: true });

  console.log('\n▶ Admin: pengaturan langsung berlaku & panel bisa digulir');
  await keMenu();
  const tombolAdmin = await pg.evaluate(() => {
    const b = document.getElementById('btnAdminOpen');
    const r = b.getBoundingClientRect();
    return { teks: b.textContent.trim(), label: b.getAttribute('aria-label'), w: r.width, h: r.height };
  });
  cek(
    tombolAdmin.teks === '' && tombolAdmin.label === 'Admin' && tombolAdmin.w <= 48 && tombolAdmin.h >= 44,
    'tombol Admin hanya ikon kecil (tanpa tulisan, tetap mudah disentuh)',
    tombolAdmin,
  );
  // Operator taps Password straight away: the "cursor to ID" a moment later must not steal it
  const fokusLogin = await pg.evaluate(async () => {
    document.getElementById('btnAdminOpen').click();
    document.getElementById('pw').focus();
    await new Promise(r => setTimeout(r, 150));
    return document.activeElement.id;
  });
  cek(fokusLogin === 'pw', 'login Admin: kursor tidak pindah dari Password ke ID', fokusLogin);
  await pg.click('#btnLoginBack');
  await tungguLayar('home');
  await pg.click('#btnAdminOpen');
  await pg.fill('#uid', 'leura');
  await pg.fill('#pw', '1234');
  await pg.click('#btnLogin');
  await pg.waitForSelector('#adminPanel', { state: 'visible', timeout: 5000 }).catch(() => {});
  await tunggu(300);
  cek(await pg.isVisible('#adminPanel'), 'login Admin berhasil');
  cek(
    (await pg.textContent('#infoVersion')) === 'Version 1.0.0 · development (npm start, branch chore/mac-installer)',
    'Admin → About: versi & branch',
    await pg.textContent('#infoVersion'),
  );
  await bersihkan();
  await pg.locator('#btnLicenses').scrollIntoViewIfNeeded();
  await pg.click('#btnLicenses');
  await tunggu(100);
  cek((await log()).includes('lisensi'), 'tombol "Open-source licenses"');
  cek(
    (await pg.textContent('#diskFree')) === 'Free space: 200 GB of 500 GB',
    'Admin → Storage: sisa disk folder penyimpanan',
    await pg.textContent('#diskFree'),
  );
  await atur({ disk: { ok: true, free: 0.5 * 1024 ** 3, total: 500 * 1024 ** 3, level: 'full' } });
  await pg.evaluate(() => __leura.refreshDiskSpace());
  cek(
    /0\.5 GB of 500 GB/.test(await pg.textContent('#diskFree')) &&
      (await pg.getAttribute('#diskFree', 'class')).includes('full'),
    'disk penuh: tampil merah di Admin',
  );
  cek(/Storage is full/.test(await pg.textContent('#notice')), 'disk penuh: operator mendapat pemberitahuan');
  await pg.click('#btnAdminBack');
  await pg.evaluate(() => __leura.show('start'));
  await pg.evaluate(() => __leura.setNotice(''));
  await pg.click('#btnStart');
  await tunggu(200);
  cek(
    (await layar()) === 'start' && /Storage is full/.test(await pg.textContent('#notice')),
    'disk penuh: tombol Start tidak membuka sesi baru',
  );
  await atur({ disk: null });
  await pg.evaluate(() => __leura.refreshDiskSpace());
  await pg.evaluate(() => __leura.setNotice(''));
  await pg.evaluate(() => __leura.show('home'));
  await pg.click('#btnAdminOpen');
  await tunggu(300);
  await pg.locator('#adminPanel').evaluate(e => {
    e.scrollTop = 0;
  });
  await pg.click('#btnAdminBack');
  await pg.click('#btnAdminOpen');
  await tunggu(300);
  cek(
    (await pg.isVisible('#adminPanel')) && !(await pg.isVisible('#adminLogin')),
    'Admin dibuka lagi: tidak perlu login lagi',
  );
  const body = pg.locator('#adminPanel .sheet-body');
  const bb = await body.boundingBox();
  await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await pg.mouse.wheel(0, 500);
  await tunggu(400);
  cek((await body.evaluate(e => e.scrollTop)) > 0, 'panel Admin bisa digulir');
  await pg.locator('.sw').nth(2).click();
  await tunggu(200);
  cek(
    (await pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())) ===
      '#7C9A7E',
    'warna langsung berubah',
  );

  console.log('\n▶ Pengaturan videobooth');
  await pg.locator('#btnSetVideo').scrollIntoViewIfNeeded();
  await pg.click('#btnSetVideo');
  await tunggu(300);
  cek((await layar()) === 'setvideo', 'halaman Pengaturan videobooth terbuka dari Admin');
  await pg.selectOption('#setSeconds', '30');
  await tunggu(150);
  await pg.selectOption('#setMessageCountdown', '0');
  await tunggu(150);
  cek(/Message countdown: record right away/.test(await pg.textContent('#setVideoMsg')), 'konfirmasi tersimpan tampil');
  await pg.click('#btnSetVideoBack');
  cek((await layar()) === 'admin', 'tombol Admin kembali ke halaman Admin');

  console.log('\n▶ Pengaturan photobooth');
  await pg.locator('#btnSetPhoto').scrollIntoViewIfNeeded();
  await pg.click('#btnSetPhoto');
  await tunggu(300);
  cek((await layar()) === 'setphoto', 'halaman Pengaturan photobooth terbuka dari Admin');
  await pg.selectOption('#setPhotoCountdown', '3');
  await pg.selectOption('#setPhotoPreview', '0');
  await tunggu(150);
  await pg.click('#setPhotoFlash');
  await tunggu(150);
  cek(
    !(await pg.isVisible('#setEnablePhoto')) && /per couple/.test(await pg.textContent('#setphoto')),
    'saklar menu tidak lagi di Pengaturan photobooth (pindah ke couple)',
  );

  console.log('\n▶ Halaman couple & editor template');
  await pg.click('#btnSetPhotoBack');
  await tunggu(300);
  const baris = pg.locator('#coupleList .cp-row');
  cek(
    (await baris.count()) === 2 &&
      /Rina & Dimas.*Active/.test(await baris.first().textContent()) &&
      /Message, Quiz \(3 questions\), Photo · 0 templates · 1 session/.test(await baris.first().textContent()),
    'Admin menampilkan daftar couple, couple aktif paling atas',
    await baris.first().textContent(),
  );
  await baris.nth(1).click();
  await tunggu(300);
  cek(
    (await layar()) === 'coupleForm' &&
      (await pg.textContent('#coupleFormTitle')) === 'Ayu & Budi' &&
      (await pg.isVisible('#btnTplNew')),
    'ketuk couple membuka halaman couple itu, lengkap dengan bagian template',
  );
  await pg.click('#btnCoupleCancel');
  await baris.first().click();
  await tunggu(300);
  cek(
    (await pg.textContent('#coupleFormTitle')) === 'Rina & Dimas' &&
      /No templates yet/.test(await pg.textContent('#tplList')),
    'template couple Rina & Dimas masih kosong',
  );
  // Album after the event: status on the couple page; videos still processing → asks once more
  cek(
    /No album yet · 3 sessions · 1 video\(s\) still being processed/.test(await pg.textContent('#albumStatus')),
    'halaman couple: status album',
    await pg.textContent('#albumStatus'),
  );
  await pg.click('#btnCoupleAlbum');
  await tunggu(150);
  cek(
    (await pg.textContent('#albumLabel')) === 'Create anyway?' &&
      /still being processed/.test(await pg.textContent('#cpMsg')),
    'Create album: video masih diproses → minta konfirmasi',
  );
  await pg.click('#btnCoupleAlbum');
  await tunggu(150);
  cek(
    (await log()).join(',').includes('album ask,album anyway') && /Album created/.test(await pg.textContent('#cpMsg')),
    'ditekan lagi: album dibuat',
  );
  await pg.click('#btnTplNew');
  await tunggu(400);
  cek(
    (await layar()) === 'tpleditor' && (await pg.locator('.te-slot').count()) === 4,
    'editor template terbuka dengan kotak foto 1-4',
  );
  const rasioSlot = () => pg.evaluate(() => __leura.te.tpl.slots.map(s => s.w / s.h));
  cek(
    (await pg.evaluate(() => __leura.te.tpl.ratio)) === '3:2' &&
      (await rasioSlot()).every(r => Math.abs(r - 1.5) < 0.01),
    'template baru memakai rasio 3:2 (sama dengan foto kamera)',
  );
  await pg.click('[data-tab="photo"]');
  await pg.locator('#teRatio .pe-opt', { hasText: '1:1' }).click();
  await tunggu(150);
  cek(
    (await rasioSlot()).every(r => Math.abs(r - 1) < 0.01) && /1:1 ratio/.test(await pg.textContent('#teRatioInfo')),
    'pilih rasio 1:1: semua kotak foto jadi persegi',
    await rasioSlot(),
  );
  await pg.click('[data-tab="design"]');
  cek(
    /Rina & Dimas/.test(await pg.textContent('#teTitle')),
    'judul editor menyebut couple-nya',
    await pg.textContent('#teTitle'),
  );
  await pg.fill('#teName', 'Rustic emas');
  const slot = await pg.locator('.te-slot').first().boundingBox();
  const x0 = await pg.evaluate(() => __leura.te.tpl.slots[0].x);
  await pg.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(slot.x + slot.width / 2 + 40, slot.y + slot.height / 2 + 30, { steps: 5 });
  await pg.mouse.up();
  cek((await pg.evaluate(() => __leura.te.tpl.slots[0].x)) > x0 + 40, 'kotak foto 1 bisa digeser dengan jari');
  const pj = await pg.locator('.te-slot').nth(1).locator('.te-resize').boundingBox();
  const w0 = await pg.evaluate(() => __leura.te.tpl.slots[1].w);
  await pg.mouse.move(pj.x + pj.width / 2, pj.y + pj.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(pj.x - 30, pj.y + pj.height / 2, { steps: 5 });
  await pg.mouse.up();
  cek((await pg.evaluate(() => __leura.te.tpl.slots[1].w)) < w0, 'ukuran kotak foto bisa diubah dari pojoknya');
  cek(
    await pg.evaluate(() => Math.abs(__leura.te.tpl.slots[1].w - __leura.te.tpl.slots[1].h) <= 1),
    'saat diubah ukurannya, rasio kotak foto tetap 1:1',
  );
  const posisi = await pg.evaluate(() => JSON.stringify(__leura.te.tpl.slots.slice(0, 2)));
  await pg.click('[data-tab="photo"]');
  await pg.locator('#teSlotChoose button').first().click();
  await pg.click('#teSlotSwap');
  cek(
    await pg.evaluate(p => JSON.stringify([__leura.te.tpl.slots[1], __leura.te.tpl.slots[0]]) === p, posisi),
    'posisi foto 1 dan 2 bisa ditukar',
  );
  await pg.locator('#teLayout .pe-opt').nth(1).click();
  cek(
    await pg.evaluate(() => __leura.te.tpl.slots.every(s => s.x === __leura.te.tpl.slots[0].x)),
    'susunan cepat "Kolom" dipakai',
  );
  await pg.click('[data-tab="text"]');
  await pg.click('#teTextAdd');
  await pg.fill('#teTextContent', 'Terima kasih sudah datang');
  await pg.locator('#teTextFont button').nth(1).click();
  cek(
    await pg.evaluate(
      () =>
        __leura.te.tpl.texts.length === 3 &&
        __leura.te.tpl.texts[2].text === 'Terima kasih sudah datang' &&
        __leura.te.tpl.texts[2].font === 'serif',
    ),
    'teks baru ditambahkan & hurufnya bisa diganti',
    await pg.evaluate(() => __leura.te.tpl.texts.map(t => t.text + '|' + t.font)),
  );
  await pg.click('[data-tab="design"]');
  await pg.locator('#teSize .pe-opt').nth(2).click();
  await tunggu(200);
  cek(
    await pg.evaluate(
      () =>
        __leura.te.tpl.W === 600 &&
        __leura.te.tpl.H === 1800 &&
        __leura.te.tpl.slots.every(s => s.x + s.w <= 600 && Math.abs(s.w / s.h - 1) < 0.02),
    ),
    'ganti ukuran ke Strip: posisi menyesuaikan, rasio tetap',
  );
  await pg.locator('#teSize .pe-opt').nth(0).click();
  await tunggu(200);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  await pg.setInputFiles('#teFrameFile', { name: 'bingkai.png', mimeType: 'image/png', buffer: png });
  await tunggu(300);
  cek(/bingkai\.png/.test(await pg.textContent('#teFrameStatus')), 'bingkai PNG bisa diunggah');
  await pg.setInputFiles('#teFrameFile', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: png });
  await tunggu(200);
  cek(/must be a PNG/.test(await pg.textContent('#teMsg')), 'bingkai JPG ditolak dengan pesan jelas');
  // QR for prints: a new template has one in the bottom-right corner; it can be moved, resized, turned off
  await pg.click('[data-tab="print"]');
  const qrNow = () => pg.evaluate(() => ({ ...__leura.te.tpl.qr }));
  const q0 = await pg.evaluate(() => ({ ...__leura.te.tpl.qr, W: __leura.te.tpl.W, H: __leura.te.tpl.H }));
  cek(
    (await pg.isChecked('#teQrOn')) && (await pg.locator('.te-qr').count()) === 1 && q0.x > q0.W / 2 && q0.y > q0.H / 2,
    'template baru: QR cetak di pojok kanan bawah',
    q0,
  );
  await pg.locator('#teQrCorners [data-corner="tl"]').click();
  const q1 = await qrNow();
  cek(q1.x < 100 && q1.y < 100, 'tombol posisi: QR pindah ke kiri atas', q1);
  const kotakQr = await pg.locator('.te-qr').boundingBox();
  await pg.mouse.move(kotakQr.x + kotakQr.width / 2, kotakQr.y + kotakQr.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(kotakQr.x + kotakQr.width / 2 + 60, kotakQr.y + kotakQr.height / 2 + 80, { steps: 4 });
  await pg.mouse.up();
  const q2 = await qrNow();
  cek(q2.x > q1.x && q2.y > q1.y, 'QR bisa digeser di kanvas', q2);
  await pg.locator('#teQrSize').fill('300');
  cek(
    (await qrNow()).size === 300 && /300 px · 2\.5 cm/.test(await pg.textContent('#teQrSizeValue')),
    'ukuran QR diatur, tampil dalam cm',
  );
  await pg.uncheck('#teQrOn');
  cek((await pg.locator('.te-qr').count()) === 0 && !(await pg.isVisible('#teQrEdit')), 'QR cetak bisa dimatikan');
  await pg.check('#teQrOn');
  cek((await qrNow()).size === 300, 'dinyalakan lagi: posisi & ukuran tetap');
  cek(
    (await pg.locator('.te-qr').textContent()) === '' &&
      (await pg.evaluate(() => getComputedStyle(document.querySelector('.te-qr')).borderTopColor)) !==
        'rgb(10, 132, 255)',
    'kotak QR di editor tanpa warna biru & tanpa tulisan',
  );
  await pg.click('#teSave');
  await tunggu(400);
  const simpan = await pg.evaluate(() => window.SIMPAN_TPL);
  cek(
    (await layar()) === 'coupleForm' &&
      simpan.t.name === 'Rustic emas' &&
      simpan.t.coupleId === 'a' &&
      simpan.frame === png.length &&
      simpan.t.qr.enabled &&
      simpan.t.qr.size === 300,
    'template tersimpan untuk couple aktif beserta bingkainya & QR cetak',
    simpan && { name: simpan.t.name, frame: simpan.frame },
  );
  cek(
    (await pg.locator('#tplList .tpl-row').count()) === 1 && /Rustic emas/.test(await pg.textContent('#tplList')),
    'template tampil di daftar',
  );
  await pg.locator('#tplList .tpl-row button', { hasText: 'Edit' }).click();
  await tunggu(300);
  cek(
    (await pg.inputValue('#teName')) === 'Rustic emas' && /frame/i.test(await pg.textContent('#teFrameStatus')),
    'template bisa dibuka lagi untuk diedit',
  );
  await pg.fill('#teName', 'Rustic emas 2');
  await pg.click('#teCancel');
  cek(
    (await layar()) === 'tpleditor' && /Buang/.test(await pg.textContent('#teCancel')),
    'Batal dengan perubahan minta konfirmasi',
  );
  await pg.click('#teCancel');
  await tunggu(200);
  cek(
    (await layar()) === 'coupleForm' && (await pg.evaluate(() => TPL[0].name)) === 'Rustic emas',
    'Batal tidak menyimpan perubahan',
  );
  cek((await pg.evaluate(() => TPL[0].ratio)) === '1:1', 'rasio foto ikut tersimpan di template');
  await pg.evaluate(() => __leura.openTemplateEditor({ ...TPL[0], id: 'lama', ratio: undefined }));
  await tunggu(300);
  await pg.click('#teSave');
  await tunggu(200);
  cek(
    (await layar()) === 'tpleditor' &&
      /Choose a photo ratio first/.test(await pg.textContent('#teMsg')) &&
      /no photo ratio yet/.test(await pg.textContent('#teRatioInfo')),
    'template lama tanpa rasio tidak bisa disimpan sebelum rasio dipilih',
  );
  await pg.click('#teCancel');
  await tunggu(200);
  console.log('\n▶ Menu per couple');
  cek(
    (await pg.isChecked('#fMenuMessage')) && (await pg.isChecked('#fMenuQuiz')) && (await pg.isChecked('#fMenuPhoto')),
    'halaman couple menampilkan saklar 3 menu',
  );
  await pg.click('#fMenuMessage');
  await pg.click('#fMenuQuiz');
  await pg.click('#fMenuPhoto');
  await tunggu(100);
  cek(
    (await pg.isChecked('#fMenuPhoto')) && /At least one option/.test(await pg.textContent('#fMenuMsg')),
    'menu terakhir tidak bisa dimatikan',
  );
  await pg.click('#fMenuMessage');
  await pg.click('#btnCoupleSave');
  await tunggu(300);
  const menuA = await pg.evaluate(() => CP.couples[0].menu);
  cek(
    (await layar()) === 'admin' && menuA.message && !menuA.quiz && menuA.photo,
    'menu couple tersimpan (Quick quiz mati)',
    menuA,
  );
  cek(
    /Rina & Dimas.*Message, Photo · 1 template/.test(await baris.first().textContent()),
    'daftar couple menunjukkan menu aktif & jumlah template',
    await baris.first().textContent(),
  );
  await pg.click('#btnAdminBack');
  cek(
    !(await pg.isVisible('#btnToQuiz')) && (await pg.isVisible('#btnToMessage')) && (await pg.isVisible('#btnToPhoto')),
    'Halaman Utama: Quick quiz tersembunyi, menu lain tetap tampil',
  );

  console.log('\n▶ Pengaturan dipakai saat sesi');
  await bersihkan();
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(400);
  cek(
    (await log()).includes('start message') && !(await pg.isVisible('#countOverlay')),
    'hitung mundur "langsung merekam": rekaman mulai tanpa menunggu',
  );
  await pg.click('#btnFinish');
  await tungguLayar('thanks');
  await keMenu();
  await pg.evaluate(() => __leura.applySettings({ ...__leura.state.cfg, messageMaxSeconds: 2 }));
  await bersihkan();
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(300);
  cek(
    / \/ 0:02$/.test(await pg.textContent('#messageTime')),
    'durasi pesan menampilkan batasnya',
    await pg.textContent('#messageTime'),
  );
  await tungguLayar('saving', 5000);
  cek(true, 'batas durasi tercapai: rekaman berhenti sendiri');
  await tungguLayar('thanks');
  await keMenu();
  await pg.evaluate(() => {
    __leura.applySettings({ ...__leura.state.cfg, messageMaxSeconds: 0 });
    __leura.state.activeCouple.menu.quiz = true;
    __leura.applyMenu();
  });
  await pg.click('#btnToQuiz');
  cek(/30 detik/.test(await pg.textContent('#quizInfo')), 'waktu jawab baru langsung dipakai quiz');
  await pg.click('#btnQuizBack');

  console.log('\n▶ Photo booth');
  await pg.click('#btnToPhoto');
  cek(
    /4 foto · hitung mundur 3 detik/.test(await pg.textContent('#pbIntro')),
    'penjelasan Photo booth mengikuti hitung mundur 3 detik',
  );
  await pg.evaluate(() => {
    window.KILAT = 0;
    new MutationObserver(() => {
      if (document.getElementById('pbFlash').classList.contains('on')) KILAT++;
    }).observe(document.getElementById('pbFlash'), { attributes: true });
  });
  await pg.evaluate(() => {
    window.HITUNG = [];
    new MutationObserver(() =>
      HITUNG.push(
        document.getElementById('pbCountNum').textContent +
          (document.getElementById('pbCount').classList.contains('small') ? 'k' : 'B'),
      ),
    ).observe(document.getElementById('pbCountNum'), { childList: true });
  });
  const t0 = Date.now();
  await pg.click('#pbStart');
  await tunggu(700);
  const zona = await pg.evaluate(() => {
    const r = document.querySelector('#pbSafe .frame').getBoundingClientRect();
    return {
      on: document.getElementById('pbSafe').classList.contains('on'),
      w: r.width,
      h: r.height,
      x: r.left + r.width / 2,
      lebar: innerWidth,
    };
  });
  cek(
    zona.on && Math.abs(zona.w / zona.h - 1) < 0.02 && Math.abs(zona.x - zona.lebar / 2) < 2,
    'saat difoto: zona aman tampil di tengah sesuai rasio template (1:1)',
    zona,
  );
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 });
  cek(
    !(await pg.evaluate(() => document.getElementById('pbSafe').classList.contains('on'))),
    'setelah 4 foto selesai, zona aman disembunyikan',
  );
  const lama = (Date.now() - t0) / 1000;
  cek(lama < 19, 'sesi 4 foto dengan hitung mundur 3 detik & tanpa pratinjau selesai lebih cepat', lama);
  cek((await pg.evaluate(() => KILAT)) === 0, 'efek kilat mati sesuai pengaturan');
  const hitung = await pg.evaluate(() => HITUNG.join(' '));
  cek(
    hitung === '3B 2k 1k 3k 2k 1k 3k 2k 1k 3k 2k 1k',
    'hitung mundur pertama besar lalu mengecil, foto 2-4 tetap kecil',
    hitung,
  );
  await pg.evaluate(() =>
    __leura.applySettings({ ...__leura.state.cfg, photoCountdown: 5, photoPreview: 2, photoFlash: true }),
  );
  await pg.evaluate(() => {
    HITUNG.length = 0;
  });
  await pg.click('[data-redo="0"]');
  await tunggu(5600);
  cek(
    (await pg.evaluate(() => HITUNG.join(' '))) === '5k 4k 3k 2k 1k',
    'hitung mundur saat Ulangi tetap kecil di pojok',
    await pg.evaluate(() => HITUNG.join(' ')),
  );
  cek(
    (await pg.isVisible('#pbPreview')) && (await pg.evaluate(() => KILAT)) === 1,
    'pratinjau & kilat aktif lagi setelah pengaturan dinyalakan',
  );
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 15000 });
  cek((await pg.locator('.pb-thumb.filled').count()) === 4, '4 foto tampil berderet');
  cek(await pg.isVisible('[data-redo="1"]'), 'tombol Ulangi tampil di bawah foto');
  await pg.click('[data-redo="1"]');
  await tunggu(500);
  cek(
    /Ulangi foto 2/.test(await pg.textContent('#pbPillText')) && !(await pg.isVisible('#pbFinish')),
    'ulangi foto 2 berjalan',
  );
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 15000 });
  await pg.click('#pbFinish');
  await tunggu(500);
  cek((await layar()) === 'editphoto', 'Finish & edit membuka halaman Edit');
  cek(
    (await pg.evaluate(
      () => document.querySelector('#peLayouts .pe-opt.on') === document.querySelector('#peLayouts .pe-opt'),
    )) && /Rustic emas/.test(await pg.textContent('#peLayouts .pe-opt')),
    'template admin tampil pertama & langsung terpilih',
  );
  cek(
    (await pg.locator('#peLayouts .pe-opt').count()) === 1,
    'tamu tidak bisa memilih layout bawaan, hanya layout dari admin',
  );
  cek(
    !(await pg.isVisible('#peTabs [data-tab="layout"]')) &&
      !(await pg.isVisible('#peTabs [data-tab="frame"]')) &&
      (await pg.isVisible('#peFilters')),
    'hanya satu template: tab Layout & Bingkai disembunyikan, tamu langsung di tab Filter',
  );
  await pg.click('#peTabs [data-tab="filter"]');
  await pg.locator('#peFilters .pe-opt').nth(1).click();
  await pg.click('#peTabs [data-tab="sticker"]');
  await pg.locator('#peStickerList .pe-stk').first().click();
  cek((await pg.locator('.pe-sticker').count()) === 1, 'stiker bisa ditambahkan');
  await pg.click('#peDone');
  await tungguLayar('thanks');
  const foto = await pg.evaluate(() => window.FOTO);
  cek(
    foto &&
      foto.n === 4 &&
      foto.meta.filter === 'bw' &&
      foto.meta.stickers === 1 &&
      foto.meta.template === 'Rustic emas',
    'foto disimpan: 4 asli + hasil edit',
    foto,
  );
  cek(
    (await pg.textContent('#thanksMsg')) === 'Fotomu sudah tersimpan.' && (await pg.isVisible('#thanksPhoto')),
    'Terima kasih menampilkan pratinjau foto',
  );
  await keMenu();
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(4300);
  await pg.click('#btnFinish');
  await tungguLayar('thanks');
  cek(!(await pg.isVisible('#thanksPhoto')), 'setelah sesi video, pratinjau foto tidak ikut tampil');

  console.log('\n▶ Filter foto (LUT) per template');
  await pg.evaluate(() => {
    __leura.show('admin');
  });
  await pg.locator('#coupleList .cp-row').first().click();
  await tunggu(300);
  await pg.locator('#tplList .tpl-row button', { hasText: 'Edit' }).click();
  await tunggu(400);
  await pg.click('.te-tab[data-tab="filter"]');
  await tunggu(300);
  cek(
    (await pg.locator('#teFilter .pe-opt').count()) === 1 &&
      /No filters yet/.test(await pg.textContent('#teFilterInfo')) &&
      !(await pg.isVisible('#teFilterManage')),
    'tab Filter: awalnya hanya "Tanpa filter" + ajakan menambah filter',
  );
  let kubus = 'TITLE "Kebalikan"\nLUT_3D_SIZE 2\n';
  for (let b = 0; b < 2; b++)
    for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) kubus += `${1 - r} ${1 - g} ${1 - b}\n`;
  await pg.setInputFiles('#teFilterFile', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') });
  await tunggu(200);
  cek(/ending in \.cube/.test(await pg.textContent('#teMsg')), 'file selain .cube ditolak di editor');
  await pg.setInputFiles('#teFilterFile', {
    name: 'Rusak.cube',
    mimeType: 'text/plain',
    buffer: Buffer.from('LUT_3D_SIZE 2\n0 0 0'),
  });
  await tunggu(200);
  cek(
    /Missing color data/.test(await pg.textContent('#teMsg')),
    'file .cube rusak ditolak dengan pesan jelas',
    await pg.textContent('#teMsg'),
  );
  await pg.setInputFiles('#teFilterFile', {
    name: 'Kebalikan.cube',
    mimeType: 'text/plain',
    buffer: Buffer.from(kubus),
  });
  await tunggu(700);
  cek(
    (await pg.locator('#teFilter .pe-opt').count()) === 2 &&
      /Kebalikan/.test(await pg.textContent('#teFilter .pe-opt.on')) &&
      /All guest photos use the "Kebalikan" filter \(100%\)/.test(await pg.textContent('#teFilterInfo')) &&
      (await pg.isVisible('#teFilterManage')),
    'filter .cube ditambahkan, langsung terpilih untuk template ini',
  );
  const pratinjau = await pg.evaluate(() => {
    // foto contoh di kotak foto editor ikut difilter (warna terbalik)
    const asli = __leura.sampleFilterPhoto().getContext('2d').getImageData(10, 10, 1, 1).data,
      f = __leura.te.samplePhoto.getContext('2d').getImageData(10, 10, 1, 1).data;
    return [Math.abs(255 - asli[0] - f[0]), Math.abs(255 - asli[2] - f[2])];
  });
  cek(pratinjau[0] <= 2 && pratinjau[1] <= 2, 'pratinjau editor: foto contoh di kotak foto memakai filter', pratinjau);
  await pg.fill('#teFilterStrength', '60');
  await pg.dispatchEvent('#teFilterStrength', 'change');
  await tunggu(300);
  cek(/\(60%\)/.test(await pg.textContent('#teFilterInfo')), 'kekuatan filter bisa diatur');
  await pg.click('label.switch:has(#teFilterGuest)');
  await tunggu(200);
  cek(
    /Guests can't change it/.test(await pg.textContent('#teFilterInfo')),
    'admin bisa mengunci filter (tamu tidak bisa menggantinya)',
  );
  await pg.click('#teSave');
  await tunggu(400);
  const tplF = await pg.evaluate(() => TPL[0]);
  cek(
    tplF.filter === 'lut1' && tplF.filterStrength === 60 && tplF.guestPicksFilter === false,
    'filter, kekuatan & kunci tersimpan di template',
    [tplF.filter, tplF.filterStrength, tplF.guestPicksFilter],
  );
  cek(/with filter/.test(await pg.textContent('#tplList')), 'daftar template menandai template berfilter');
  await pg.evaluate(() => {
    __leura.applySettings({ ...__leura.state.cfg, photoCountdown: 2, photoPreview: 0, photoFlash: false });
    __leura.show('home');
  });
  await pg.click('#btnToPhoto');
  await pg.click('#pbStart');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 30000 });
  await pg.click('#pbFinish');
  await tunggu(800);
  cek(
    (await layar()) === 'editphoto' && !(await pg.isVisible('#peTabs [data-tab="filter"]')),
    'filter dikunci: tab Filter tidak tampil untuk tamu',
  );
  await pg.click('#peDone');
  await tungguLayar('thanks');
  cek(
    (await pg.evaluate(() => window.FOTO.meta.filter)) === 'template: Kebalikan',
    'foto tamu memakai filter template',
    await pg.evaluate(() => window.FOTO.meta.filter),
  );
  await pg.evaluate(() => {
    TPL[0].guestPicksFilter = true;
  });
  await keMenu();
  await pg.click('#btnToPhoto');
  await pg.click('#pbStart');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 30000 });
  await pg.click('#pbFinish');
  await tunggu(800);
  const opsiF = await pg.evaluate(() =>
    [...document.querySelectorAll('#peFilters .pe-opt')].map(b => b.textContent.trim()),
  );
  cek(
    (await pg.isVisible('#peTabs [data-tab="filter"]')) &&
      opsiF[0] === 'Kebalikan' &&
      opsiF.length === 7 &&
      /Kebalikan/.test(await pg.textContent('#peFilters .pe-opt.on')),
    'filter tidak dikunci: filter template tampil pertama & terpilih, tamu bisa memilih filter lain',
    opsiF,
  );
  await pg.click('#peDone');
  await tungguLayar('thanks');
  await keMenu();

  console.log('\n▶ Hapus template');
  await pg.evaluate(() => {
    __leura.show('admin');
  });
  await pg.locator('#coupleList .cp-row').first().click();
  await tunggu(300);
  const hapus = pg.locator('#tplList .tpl-row button', { hasText: 'Delete' });
  await hapus.click();
  cek(
    (await pg.evaluate(() => TPL.length)) === 1 && /for sure/.test(await hapus.textContent()),
    'hapus template minta ketuk dua kali',
  );
  await pg.locator('#tplList .tpl-row button', { hasText: 'for sure' }).click();
  await tunggu(300);
  cek(
    (await pg.evaluate(() => TPL.length)) === 0 && /No templates yet/.test(await pg.textContent('#tplList')),
    'template terhapus dari daftar',
  );
  await pg.evaluate(() => {
    __leura.applySettings({ ...__leura.state.cfg, photoCountdown: 3, photoPreview: 0 });
    __leura.show('home');
  });
  await pg.click('#btnToPhoto');
  await pg.click('#pbStart');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 });
  await pg.click('#pbFinish');
  await tunggu(500);
  cek(
    (await pg.locator('#peLayouts .pe-opt').count()) === 3 &&
      (await pg.isVisible('#peTabs [data-tab="layout"]')) &&
      (await pg.isVisible('#peTabs [data-tab="frame"]')),
    'tanpa template: tamu memakai layout bawaan',
  );
  await pg.click('#peDone');
  await tungguLayar('thanks');
  await keMenu();

  console.log('\n▶ Tambah couple baru lalu langsung buat template');
  await pg.evaluate(() => __leura.show('admin'));
  await pg.click('#btnAddCouple');
  await tunggu(200);
  cek(
    (await pg.isVisible('#cpTplNew')) && !(await pg.isVisible('#btnTplNew')) && !(await pg.isVisible('#btnDelCouple')),
    'couple baru: template muncul setelah disimpan',
  );
  await pg.fill('#fName', 'Sari & Andi');
  await pg.click('#fActive');
  await pg.click('#btnCoupleSave');
  await tunggu(300);
  cek(
    /Quick quiz is on: add at least 1 question/.test(await pg.textContent('#coupleFormErr')),
    'Quick quiz aktif tanpa pertanyaan ditolak',
  );
  await pg.click('#fMenuQuiz');
  cek(
    /Quick quiz is off/.test(await pg.textContent('#qRequired')),
    'pertanyaan ditandai tidak dipakai saat Quick quiz mati',
  );
  await pg.click('#btnCoupleSave');
  await tunggu(300);
  cek(
    (await layar()) === 'coupleForm' &&
      (await pg.isVisible('#btnTplNew')) &&
      (await pg.textContent('#coupleFormTitle')) === 'Sari & Andi',
    'setelah disimpan tetap di halaman couple & tombol Buat template muncul',
  );
  cek((await pg.evaluate(() => CP.activeId)) === 'a', 'couple aktif tidak berubah saat menyiapkan couple lain');
  await pg.click('#btnTplNew');
  await tunggu(300);
  cek(
    /Sari & Andi/.test(await pg.textContent('#teTitle')) &&
      (await pg.evaluate(() => __leura.fillTemplateText('{couple}'))) === 'Sari & Andi',
    'pratinjau {couple} memakai nama couple yang diedit',
  );
  await pg.click('#teSave');
  await tunggu(300);
  cek(
    await pg.evaluate(() => TPL.length === 1 && TPL[0].coupleId === 'n2'),
    'template tersimpan untuk couple baru, bukan couple aktif',
  );
  await pg.click('#btnCoupleFolder');
  cek((await log()).includes('folder n2'), 'Buka folder couple membuka folder couple yang diedit');
  await pg.click('#btnDelCouple');
  cek(
    (await layar()) === 'coupleForm' && /for sure/.test(await pg.textContent('#delLabel')),
    'hapus couple minta ketuk dua kali',
  );
  await pg.click('#btnDelCouple');
  await tunggu(300);
  cek(
    (await layar()) === 'admin' &&
      (await pg.locator('#coupleList .cp-row').count()) === 2 &&
      (await pg.evaluate(() => TPL.length)) === 0,
    'couple terhapus beserta templatenya',
  );
  cek(/and 1 template/.test(await pg.textContent('#coupleMsg')), 'pesan menyebut template yang ikut terhapus');
  cek(
    (await pg.evaluate(() => __leura.fillTemplateText('{couple}'))) === 'Rina & Dimas',
    'di luar halaman couple, {couple} kembali ke couple aktif',
  );

  console.log('\n▶ Kamera Sony');
  await pg.evaluate(() => __leura.show('admin'));
  cek(
    (await pg.inputValue('#camSource')) === 'webcam' && !(await pg.isVisible('#sonyRow')),
    'Admin: sumber kamera bawaan Webcam / HP',
  );
  await pg.selectOption('#camSource', 'sony-sim');
  await tunggu(400);
  cek(
    await pg.evaluate(() => document.body.classList.contains('sonyOn') && __leura.state.mediaStream === null),
    'pilih Sony: webcam & mic komputer dilepas',
  );
  cek(
    (await pg.isVisible('#sonyRow')) &&
      !(await pg.isVisible('#camSelRow')) &&
      /connected · battery 100%/.test(await pg.textContent('#sonyStatus')),
    'status kamera Sony tampil, pilihan webcam disembunyikan',
    await pg.textContent('#sonyStatus'),
  );
  cek(/mic into the camera's mic jack/.test(await pg.textContent('#camHint')), 'petunjuk mic & dummy battery tampil');
  await tunggu(400);
  cek(
    (await pg.evaluate(() => document.getElementById('camPrevLv').width)) === 640,
    'live view tampil di pratinjau Admin',
  );
  await pg.evaluate(() => {
    __leura.applySettings({ ...__leura.state.cfg, photoCountdown: 3, photoPreview: 0, messageCountdown: 0 });
    __leura.show('home');
  });
  await tunggu(400);
  cek((await pg.isVisible('#camLv')) && !(await pg.isVisible('#cam')), 'live view Sony jadi latar Halaman Utama');
  await bersihkan();
  await pg.click('#btnToMessage');
  await tunggu(100);
  cek((await log()).includes('mode video'), 'buka Kirim pesan: kamera Sony dipindah ke mode VIDEO');
  await pg.click('#btnMessageBack');
  await pg.evaluate(() => __leura.show('quiz'));
  await tunggu(100);
  cek((await log()).filter(x => x === 'mode video').length === 2, 'buka Quiz: kamera Sony ke mode VIDEO');
  await pg.evaluate(() => __leura.show('home'));
  await pg.click('#btnToPhoto');
  await tunggu(100);
  cek((await log()).includes('mode photo'), 'buka Photo booth: kamera Sony dipindah ke mode FOTO');
  // Transisi halus saat kamera berganti mode
  await pg.click('#pbBack');
  await tunggu(100);
  await pg.evaluate(() => {
    SONY.st = { ...SONY.st, modeKind: 'photo' };
    SONY.cb(SONY.st); // status update from the (fake) main process
    window.MODE_DELAY = 900;
  });
  await pg.click('#btnToMessage');
  await tunggu(150);
  const n1 = await pg.evaluate(() => __leura.liveViewFrameCount());
  await tunggu(400);
  const n2 = await pg.evaluate(() => __leura.liveViewFrameCount());
  cek(
    (await pg.evaluate(() => document.body.classList.contains('lvSwitching'))) && n1 === n2,
    'ganti mode: gambar kamera dibekukan + kabut (blur) selama berganti',
  );
  await tunggu(1800);
  cek(
    !(await pg.evaluate(() => document.body.classList.contains('lvSwitching'))) &&
      (await pg.evaluate(() => __leura.liveViewFrameCount())) > n2,
    'mode selesai: kabut hilang, gambar kamera jalan lagi',
  );
  await pg.evaluate(() => {
    SONY.st = { ...SONY.st, modeKind: 'video' };
    SONY.cb(SONY.st);
    window.MODE_DELAY = 0;
  });
  await pg.click('#btnMessageBack');
  await pg.evaluate(() => __leura.show('quiz'));
  await tunggu(100);
  cek(
    !(await pg.evaluate(() => document.body.classList.contains('lvSwitching'))),
    'mode sudah benar (pesan → quiz): tanpa kabut',
  );
  await pg.evaluate(() => __leura.show('home'));
  await pg.click('#btnToPhoto');
  await pg.click('#pbStart');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 });
  cek(
    (await pg.evaluate(() => SONY.photos)) === 4 && (await pg.locator('.pb-thumb.filled').count()) === 4,
    'photobooth memakai jepretan kamera Sony (4 foto)',
  );
  await pg.click('#pbFinish');
  await tunggu(500);
  await pg.click('#peDone');
  await tungguLayar('thanks');
  const fs = await pg.evaluate(() => ({ photos: window.FOTO, besar: SONY.besar }));
  cek(
    fs.photos.n === 4 && fs.photos.asli.every(n => n === fs.besar),
    'foto asli kamera disimpan utuh (tidak diperkecil)',
    fs,
  );
  await keMenu();
  await bersihkan();
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(400);
  cek((await log()).includes('start message sony'), 'Kirim pesan merekam lewat kamera Sony', await log());
  await pg.click('#btnFinish');
  await tungguLayar('thanks');
  cek(
    (await log()).some(x => /^end /.test(x)),
    'rekaman Sony dihentikan & dicatat',
  );
  await keMenu();
  await bersihkan();
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(400);
  await pg.evaluate(() => setSony({ ...SONY.st, connected: false, message: 'Kamera Sony terputus.' }));
  await tunggu(400);
  cek(
    (await layar()) === 'home' && /disconnected while recording/.test(await pg.textContent('#notice')),
    'kabel tercabut saat merekam: kembali ke Utama dengan pesan jelas',
  );
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(200);
  cek(
    (await layar()) === 'message' && /not connected/.test(await pg.textContent('#notice')),
    'kamera belum tersambung: rekaman tidak dimulai',
  );
  await pg.evaluate(() => {
    __leura.show('admin');
  });
  await pg.selectOption('#camSource', 'webcam');
  await tunggu(500);
  cek(
    await pg.evaluate(() => !document.body.classList.contains('sonyOn') && !!__leura.state.mediaStream),
    'kembali ke webcam: kamera komputer dibuka lagi',
  );

  console.log('\n▶ Riwayat sesi');
  await pg.evaluate(() => {
    const t = (hari, h, m) => {
      const d = new Date();
      d.setDate(d.getDate() - hari);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    window.SESI = [
      { id: 1, time: t(1, 19, 2), label: 'message', couple: 'Ayu & Budi', seconds: 48, status: 'done' },
      { id: 2, time: t(0, 18, 5), label: 'message', couple: 'Rina & Dimas', seconds: 42, status: 'done' },
      {
        id: 3,
        time: t(0, 18, 7),
        label: 'photo',
        couple: 'Rina & Dimas',
        status: 'photo',
        photos: 4,
        guest: 'Sari',
        prints: 1,
        printQr: { enabled: true, x: 980, y: 1580, size: 180 },
      },
      {
        id: 4,
        time: t(0, 18, 12),
        label: 'quiz',
        couple: 'Rina & Dimas',
        seconds: 60,
        status: 'failed',
        questions: ['Kapan pertama bertemu?'],
      },
      {
        id: 5,
        time: t(0, 18, 20),
        label: 'message',
        couple: 'Rina & Dimas',
        seconds: 75,
        status: 'card-only',
        camera: 'sony',
        card: 'C0005.MP4',
      },
      { id: 6, time: t(0, 18, 24), label: 'message', couple: 'Rina & Dimas', seconds: 1, status: 'done' },
      { id: 7, time: t(1, 18, 30), label: 'message', couple: 'Rina & Dimas', seconds: 30, status: 'done' },
    ];
    __leura.show('admin');
    return __leura.loadSessions();
  });
  cek(
    /Rina & Dimas: 5 today · 6 total/.test(await pg.textContent('#historySummary')) &&
      (await pg.textContent('#historyBadge')) === '⚠️ 2',
    'Admin: ringkasan sesi couple aktif + jumlah yang perlu perhatian',
    await pg.textContent('#historySummary'),
  );
  await pg.click('#btnHistory');
  await tunggu(300);
  cek(
    (await layar()) === 'history' && (await pg.inputValue('#histCouple')) === 'Rina & Dimas',
    'Riwayat sesi terbuka untuk couple aktif',
  );
  cek(
    (await pg.textContent('#histSummary')).replace(/\s/g, '') === '4Messages1Quiz1Photos3Videominutes',
    'ringkasan jumlah pesan/quiz/foto & menit video',
    await pg.textContent('#histSummary'),
  );
  // Print a photo session again from the history
  await pg.locator('#histList .hist-row', { hasText: 'Sari' }).click();
  await tunggu(200);
  cek(/Printed: 1 copy/.test(await pg.textContent('#histList .hist-detail')), 'detail sesi foto: jumlah cetak');
  await pg.locator('#histList .hist-detail button', { hasText: 'Print' }).click();
  cek(
    (await pg.locator('.hist-print button').count()) === 7 &&
      /How many prints/.test(await pg.textContent('.hist-print')),
    'Print: pilih jumlah lembar (1-6, Cancel)',
  );
  await pg.evaluate(() => (window.CETAK = null));
  await pg.locator('.hist-print button', { hasText: /^2$/ }).click();
  await pg.waitForFunction(
    () => window.CETAK && /2 prints sent/.test(document.getElementById('histMsg').textContent),
    null,
    {
      timeout: 8000,
    },
  );
  const ulang = await pg.evaluate(() => (window.CETAK ? { ...window.CETAK, image: window.CETAK.image.length } : null));
  cek(
    ulang && ulang.copies === 2 && ulang.layout === 'portrait' && ulang.guest === 'Sari' && ulang.image > 1000,
    'Riwayat sesi: foto dicetak ulang 2 lembar',
    ulang,
  );
  cek(/2 prints sent/.test(await pg.textContent('#histMsg')), 'pesan: dikirim ke printer');
  await pg.locator('#histList .hist-row', { hasText: 'Sari' }).click(); // close the detail again
  const judulHari = await pg.locator('#histList .group-title').allTextContents();
  cek(
    judulHari.length === 2 && /^Today/.test(judulHari[0]) && /^Yesterday/.test(judulHari[1]),
    'sesi dikelompokkan per hari (Hari ini, Kemarin)',
    judulHari,
  );
  cek(
    (await pg.locator('.hist-status.red').count()) === 1 &&
      (await pg.locator('.hist-status.orange').count()) === 1 &&
      (await pg.locator('.hist-status.green').count()) === 4,
    'status berwarna: gagal merah, di kartu SD oranye, siap hijau',
  );
  cek(
    /Too short/.test(await pg.locator('.hist-row', { hasText: '18:24' }).textContent()),
    'rekaman 1 detik ditandai "Terlalu pendek"',
  );
  await pg.click('#histBanner');
  await tunggu(150);
  cek((await pg.locator('.hist-row').count()) === 2, 'banner peringatan menampilkan 2 sesi bermasalah saja');
  await pg.locator('.hist-row', { hasText: 'Quiz' }).click();
  await tunggu(150);
  cek(
    /could not be converted to MP4/.test(await pg.textContent('.hist-detail')) &&
      /Kapan pertama bertemu/.test(await pg.textContent('.hist-detail')),
    'detail sesi: keterangan & pertanyaan quiz',
  );
  await bersihkan();
  await pg.locator('.hist-detail button', { hasText: 'Process again' }).click();
  await tunggu(400);
  cek(
    (await log()).includes('ulang 4') &&
      (await pg.evaluate(() => SESI[3].status)) === 'processing' &&
      (await pg.locator('.hist-row').count()) === 1,
    'Coba proses lagi: sesi diproses ulang & keluar dari daftar "perlu perhatian"',
  );
  await pg.click('#histBanner');
  await pg.locator('.hist-chip', { hasText: 'Photos' }).click();
  await pg.locator('.hist-row').first().click();
  await pg.locator('.hist-detail button', { hasText: 'View photo' }).click();
  await pg.locator('.hist-detail button', { hasText: 'Show in Finder' }).click();
  await tunggu(100);
  cek(
    (await log()).includes('buka 3') && (await log()).includes('finder 3'),
    'foto bisa dibuka & ditampilkan di Finder',
  );
  await pg.selectOption('#histCouple', '');
  await pg.locator('.hist-chip', { hasText: 'All' }).click();
  await tunggu(100);
  cek(
    (await pg.locator('.hist-row').count()) === 7 && /Ayu & Budi/.test(await pg.textContent('#histList')),
    'pilihan "Semua couple" menampilkan semua sesi dengan nama couple',
  );
  cek(
    / · Photo · Sari$/.test(await pg.locator('.hist-row[data-id="3"] b').textContent()) &&
      / · Message$/.test(await pg.locator('.hist-row[data-id="1"] b').textContent()) &&
      !/undefined/.test(await pg.textContent('#histList')),
    'each row shows its kind (Message / Quiz / Photo)',
  );
  await pg.evaluate(() => {
    SESI.push({
      id: 8,
      time: new Date().toISOString(),
      label: 'message',
      couple: 'Rina & Dimas',
      seconds: 20,
      status: 'transfer',
      camera: 'sony',
    });
  });
  await tunggu(3500);
  cek((await pg.locator('.hist-row').count()) === 8, 'daftar diperbarui sendiri tanpa menekan Segarkan');
  await pg.evaluate(() => {
    SESI.push({
      id: 9,
      time: new Date().toISOString(),
      label: 'quiz',
      couple: 'Rina & Dimas',
      seconds: 30,
      status: 'captions',
    });
  });
  await tunggu(3500);
  cek(
    /Adding questions/.test(await pg.locator('.hist-row[data-id="9"]').textContent()),
    'quiz video getting its question texts shows "Adding questions"',
  );
  await pg.click('#histBack');
  cek((await layar()) === 'admin', 'tombol Admin kembali');

  console.log('\n▶ Bahasa layar tamu');
  await pg.evaluate(() => __leura.show('admin'));
  cek((await pg.inputValue('#setGuestLanguage')) === 'id', 'bahasa layar tamu dari pengaturan tampil di Admin');
  // Ganti bahasa tamu ke English
  await pg.selectOption('#setGuestLanguage', 'en');
  await tunggu(300);
  cek(
    /now in English/.test(await pg.textContent('#setMsg')) &&
      /Add couple/.test(await pg.textContent('#btnAddCouple')) &&
      /Session history/.test(await pg.textContent('#btnHistory')),
    'halaman Admin berbahasa Inggris',
  );
  await pg.click('#btnAdminBack');
  await tunggu(200);
  cek(
    /Leave a message/.test(await pg.textContent('#btnToMessage')) &&
      (await pg.textContent('#welcome')) === 'Tinggalkan pesan untuk kami' &&
      (await pg.locator('#btnToMessage svg').count()) === 1,
    'Halaman Utama berbahasa Inggris (ikon tombol tetap ada); sambutan tampil seperti yang diketik',
  );
  await pg.evaluate(() => {
    __leura.state.activeCouple.menu.quiz = true;
    __leura.applyMenu();
  });
  await pg.click('#btnToQuiz');
  cek(
    /random questions/.test(await pg.textContent('#quizInfo')) &&
      /Start quiz/.test(await pg.textContent('#btnQuizStart')) &&
      /Back/.test(await pg.textContent('#btnQuizBack')),
    'halaman Quiz berbahasa Inggris',
  );
  cek(
    (await pg.evaluate(() => __leura.state.cfg.quiz[0])) === 'Q satu',
    'pertanyaan quiz tampil seperti yang diketik admin',
  );
  await pg.click('#btnQuizBack');
  await pg.click('#btnToPhoto');
  cek(
    /4 photos · \d+-second countdown before each/.test(await pg.textContent('#pbIntro')) &&
      /Start/.test(await pg.textContent('#pbStart')),
    'halaman Photo booth berbahasa Inggris',
  );
  await pg.click('#pbStart');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 });
  cek(
    /Retake/.test(await pg.textContent('[data-redo="0"]')) && /Finish & edit/.test(await pg.textContent('#pbFinish')),
    'tombol Retake & Finish & edit',
  );
  await pg.click('#pbFinish');
  await tunggu(500);
  cek(
    /Edit photo/.test(await pg.textContent('#editphoto h2')) &&
      /Stickers/.test(await pg.textContent('#peTabs [data-tab="sticker"]')),
    'halaman Edit foto berbahasa Inggris',
  );
  cek(
    await pg.evaluate(
      () =>
        __leura.fillTemplateText('{tanggal}') ===
        new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    ),
    'tanggal di template foto ditulis dalam bahasa Inggris',
  );
  await pg.click('#peDone');
  await tungguLayar('thanks');
  cek(
    /Thank you/.test(await pg.textContent('#thanks h1')) &&
      /Your photos have been saved/.test(await pg.textContent('#thanksMsg')),
    'halaman Terima kasih berbahasa Inggris',
  );
  cek((await pg.evaluate(() => __leura.state.guestResults.length)) === 0, 'QR mati: foto tidak memberi kode QR');
  await pg.evaluate(() => __leura.state.guestResults.push({ kind: 'photo', code: 'Ab3dEf9hJk' })); // as if QR were on
  await keMenu();
  cek((await pg.textContent('#guestDoneText')) === 'Finish & get QR', 'tombol "Finish & get QR" berbahasa Inggris');
  await pg.click('#btnGuestDone');
  await tungguLayar('guestQr');
  cek(
    /All your moments, one QR/.test(await pg.textContent('#guestQr h1')) &&
      (await pg.textContent('#gqSummary')) === '1 photo session' &&
      /\?b=en$/.test(await pg.textContent('#qrLink')),
    'halaman QR tamu berbahasa Inggris (link membuka halaman bahasa Inggris)',
  );
  await pg.evaluate(() => __leura.show('admin'));
  await pg.selectOption('#setGuestLanguage', 'id');
  await tunggu(300);
  await pg.evaluate(() => __leura.show('home'));
  cek(
    /Kirim pesan/.test(await pg.textContent('#btnToMessage')) &&
      (await pg.textContent('#welcome')) === 'Tinggalkan pesan untuk kami',
    'kembali ke bahasa Indonesia',
  );

  console.log('\n▶ Unduh foto lewat QR');
  await pg.evaluate(() => {
    __leura.show('admin');
    __leura.applySettings({ ...__leura.state.cfg, photoCountdown: 3, photoPreview: 0 });
  });
  await pg.locator('#btnSetPhoto').scrollIntoViewIfNeeded();
  await pg.click('#btnSetPhoto');
  await tunggu(300);
  cek(
    !(await pg.isChecked('#setQrEnabled')) && /QR is off/.test(await pg.textContent('#qrStatus')),
    'Pengaturan photobooth: QR mati secara bawaan',
  );
  await pg.click('#btnQrSetup');
  await tunggu(200);
  cek(
    (await pg.inputValue('#setQrUrl')) === 'https://leura-foto.uji.workers.dev' &&
      /saved/.test(await pg.getAttribute('#setQrKey', 'placeholder')),
    '"Ambil dari hasil pasang" mengisi alamat & kunci',
  );
  await pg.click('#btnQrTest');
  await tunggu(200);
  cek(
    /Connected to the server. Photos are kept for 7 days/.test(await pg.textContent('#qrMsg')),
    'Tes sambungan menampilkan hasil',
  );
  await pg.click('#setQrEnabled');
  await tunggu(200);
  cek(
    (await pg.evaluate(() => UNG.st.enabled)) && /all photos sent/.test(await pg.textContent('#qrStatus')),
    'QR dinyalakan dari Admin',
  );
  cek(
    (await pg.isChecked('#setQrVideo')) &&
      (await pg.inputValue('#setQrQuality')) === '720' &&
      !(await pg.isDisabled('#setQrVideo')),
    'QR video menyala & kualitas 720p secara bawaan',
  );
  await bersihkan();
  await pg.selectOption('#setQrQuality', '1080');
  await tunggu(150);
  cek(
    (await log()).includes('unggah {"videoQuality":"1080"}') && /1080p/.test(await pg.textContent('#qrMsg')),
    'kualitas video untuk HP bisa diganti ke 1080p',
    await log(),
  );
  await pg.click('#setQrVideo');
  await tunggu(150);
  cek(
    (await log()).includes('unggah {"video":false}') &&
      (await pg.isDisabled('#setQrQuality')) &&
      /Video QR is off/.test(await pg.textContent('#qrStatus')),
    'QR video bisa dimatikan',
  );
  await pg.click('#setQrVideo');
  await tunggu(150);
  await pg.evaluate(() =>
    UNG.cb({
      ...UNG.st,
      waitingVideos: 2,
      videosProcessing: 0,
      current: 'Vid3oKode1',
      progress: { code: 'Vid3oKode1', n: 2, total: 5 },
    }),
  );
  await tunggu(100);
  cek(
    /Sending video… part 2 of 5 · 2 video\(s\) in queue/.test(await pg.textContent('#qrStatus')),
    'status: video dikirim per bagian',
    await pg.textContent('#qrStatus'),
  );
  await pg.evaluate(() => UNG.cb({ ...UNG.st, waitingVideos: 1, videosProcessing: 1, current: null, progress: null }));
  await tunggu(100);
  cek(/1 video\(s\) being prepared/.test(await pg.textContent('#qrStatus')), 'status: video sedang disiapkan');
  await pg.evaluate(() => UNG.cb({ ...UNG.st, waitingVideos: 0, videosProcessing: 0 }));
  cek(
    (await pg.evaluate(() => {
      // server address arrives through the normal upload-status update
      const u = UNG.st.url;
      UNG.cb({ ...UNG.st, url: 'https://x.workers.dev' });
      const r = [
        __leura.sessionLink({ label: 'message', code: 'K1' }),
        __leura.sessionLink({ label: 'photo', code: 'K2' }),
      ];
      UNG.cb({ ...UNG.st, url: u });
      return r.join();
    })) === 'https://x.workers.dev/v/K1,https://x.workers.dev/f/K2',
    'Riwayat: link sesi video memakai /v/, foto /f/',
  );
  await pg.evaluate(() => UNG.cb({ ...UNG.st, waiting: 2, lastError: 'No internet / server unreachable' }));
  await tunggu(100);
  cek(
    /2 photo\(s\) waiting to be sent · No internet/.test(await pg.textContent('#qrStatus')) &&
      (await pg.isVisible('#btnQrRetry')),
    'status antrean tampil langsung, ada tombol "Coba kirim sekarang"',
  );
  await bersihkan();
  await pg.click('#btnQrRetry');
  cek((await log()).includes('unggah coba'), 'Coba kirim sekarang');
  await pg.evaluate(() => __leura.show('home'));
  await pg.click('#btnToPhoto');
  await pg.click('#pbStart');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 });
  await pg.click('#pbFinish');
  await tunggu(500);
  await pg.click('#peDone');
  await tungguLayar('thanks');
  cek(
    await pg.evaluate(() => {
      const th = document.getElementById('thanks'),
        f = document.getElementById('thanksPhoto').getBoundingClientRect();
      return th.classList.contains('thanks-photo') && f.height > innerHeight * 0.6;
    }),
    'Terima kasih: hasil foto besar',
  );
  cek(
    (await pg.evaluate(() => getComputedStyle(document.getElementById('thanks')).getPropertyValue('--thanks-ms'))) ===
      '6500ms',
    'Terima kasih foto tampil lebih lama (6,5 detik)',
  );
  await keMenu();
  await atur({ qrVideo: true });
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(400);
  await pg.click('#btnFinish');
  await tungguLayar('thanks');
  await atur({ qrVideo: false });
  await keMenu();
  await pg.click('#btnGuestDone');
  await tungguLayar('guestQr');
  cek(
    (await pg.textContent('#qrLink')) === 'leura-foto.uji.workers.dev/t/Gu3stKode1' &&
      (await pg.textContent('#gqSummary')) === '1 pesan video · 1 sesi foto' &&
      JSON.stringify((await pg.evaluate(() => GQ)).items.map(x => x.kind + ':' + x.code)) ===
        '["photo:Ab3dEf9hJk","video:Vid3oKode1"]' &&
      (await pg.evaluate(() => GQ.couple)) === 'Rina & Dimas',
    'foto + pesan: SATU QR ke halaman tamu, berisi keduanya',
  );
  await tunggu(1000); // the QR pops in with an animation
  cek(
    await pg.evaluate(() => {
      const q = document.getElementById('qrCanvas').getBoundingClientRect();
      return q.width >= 300 && q.bottom <= innerHeight;
    }),
    'QR tamu besar dan muat di layar',
  );
  await pg.evaluate(() => {
    window.QRPNG = document.getElementById('qrCanvas').toDataURL('image/png');
  });
  require('fs').writeFileSync(
    require('path').join(require('os').tmpdir(), 'uji-qr.png'),
    Buffer.from((await pg.evaluate(() => QRPNG)).split(',')[1], 'base64'),
  );

  console.log('\n▶ Tamu pergi tanpa menekan "Selesai & ambil QR"');
  await pg.evaluate(() => {
    __leura.state.guestResults = [{ kind: 'photo', code: 'Ab3dEf9hJk' }];
    __leura.state.guestActivity = 1;
  });
  // Open the menu and note every long timer started meanwhile (the idle timer is 20 s or more)
  const timerMenu = await pg.evaluate(() => {
    const asli = window.setTimeout;
    const lama = [];
    window.setTimeout = (fn, ms, ...a) => {
      if (ms >= 10000) lama.push(ms);
      return asli(fn, ms, ...a);
    };
    try {
      __leura.show('home'); // show() starts the idle timer of the new page
    } finally {
      window.setTimeout = asli;
    }
    return lama;
  });
  cek(timerMenu.length === 0, 'halaman utama: tidak kembali sendiri ke Start / QR (tanpa timer diam)', timerMenu);
  // Idle on a guest page (message): the real timer is 60 s; call what it calls
  await pg.evaluate(() => {
    __leura.show('message');
    __leura.openGuestQr();
  });
  cek((await layar()) === 'guestQr', 'halaman tamu dibiarkan dengan hasil: QR tamu tampil dulu, bukan langsung Start');
  await pg.click('#btnGuestQrDone');

  console.log('\n▶ Link QR di Riwayat sesi');
  await pg.evaluate(() => {
    const jam = m => {
      const d = new Date();
      d.setHours(17, m, 0, 0);
      return d.toISOString();
    };
    SESI.push(
      {
        id: 20,
        time: jam(1),
        label: 'photo',
        couple: 'Rina & Dimas',
        status: 'photo',
        photos: 4,
        code: 'Ab3dEf9hJk',
        link: 'https://leura-foto.uji.workers.dev/f/Ab3dEf9hJk',
        upload: 'sent',
      },
      {
        id: 21,
        time: jam(2),
        label: 'photo',
        couple: 'Rina & Dimas',
        status: 'photo',
        photos: 4,
        code: 'LamaKode99',
        upload: 'waiting',
      },
    );
    __leura.show('admin');
  });
  await bersihkan();
  await pg.click('#btnHistory');
  await tunggu(400);
  await pg.click('.hist-row[data-id="20"]');
  await tunggu(200);
  cek(
    (await pg.textContent('.hist-detail .hist-link')) === 'https://leura-foto.uji.workers.dev/f/Ab3dEf9hJk' &&
      /guests can download the photos/.test(await pg.textContent('.hist-detail')),
    'detail sesi foto menampilkan link unduh + status QR',
  );
  await pg.click('.hist-detail button:has-text("Copy link")');
  await tunggu(100);
  await pg.click('.hist-detail button:has-text("Open link")');
  await tunggu(100);
  const lg = await log();
  cek(
    lg.includes('salin https://leura-foto.uji.workers.dev/f/Ab3dEf9hJk') &&
      lg.includes('buka https://leura-foto.uji.workers.dev/f/Ab3dEf9hJk') &&
      /Link copied/.test(await pg.textContent('#histMsg')),
    'tombol Salin link & Buka link',
  );
  await pg.click('.hist-detail button:has-text("Show QR")');
  await tunggu(200);
  cek(
    (await pg.isVisible('#rwQR canvas')) &&
      /leura-foto.uji.workers.dev\/f\/Ab3dEf9hJk/.test(await pg.textContent('#rwQR small')),
    'Tampilkan QR: QR besar sesi itu muncul',
  );
  await pg.evaluate(() => {
    window.QRPNG2 = document.querySelector('#rwQR canvas').toDataURL('image/png');
  });
  require('fs').writeFileSync(
    require('path').join(require('os').tmpdir(), 'uji-qr-riwayat.png'),
    Buffer.from((await pg.evaluate(() => QRPNG2)).split(',')[1], 'base64'),
  );
  await pg.click('#rwQR button');
  await tunggu(100);
  cek((await pg.locator('#rwQR').count()) === 0, 'QR besar ditutup');
  await pg.click('.hist-row[data-id="21"]');
  await tunggu(200);
  cek(
    (await pg.textContent('.hist-detail .hist-link')) === 'https://leura-foto.uji.workers.dev/f/LamaKode99',
    'sesi lama (hanya kode) tetap mendapat link dari alamat server',
  );
  await pg.click('#histBack');
  await tunggu(200);

  console.log('\n▶ Nama tamu');
  await pg.evaluate(() => __leura.show('start'));
  await pg.click('#btnStart');
  cek(
    (await layar()) === 'name' && (await pg.inputValue('#nameInput')) === '',
    'tamu berikutnya mulai dengan kolom nama kosong',
  );
  await pg.click('#btnNameBack');
  cek((await layar()) === 'start', 'Kembali dari halaman nama ke halaman Start');
  await pg.click('#btnStart');
  await pg.fill('#nameInput', 'Sari');
  await pg.press('#nameInput', 'Enter');
  cek(
    (await layar()) === 'home' && (await pg.textContent('#guestGreeting')) === 'Hai, Sari!',
    'keyboard fisik juga bisa (Enter = Lanjut)',
  );
  const ikonKembali = await pg.evaluate(() =>
    ['btnHomeBack', 'btnNameBack'].map(id => {
      const b = document.getElementById(id);
      const r = b.getBoundingClientRect();
      return { teks: b.textContent.trim(), kiri: r.left < innerWidth / 2, atas: r.top < 100, w: r.width };
    }),
  );
  cek(
    (await pg.isVisible('#btnHomeBack')) && ikonKembali[0].teks === '' && ikonKembali[0].kiri && ikonKembali[0].atas,
    'menu utama (belum ada kegiatan): tombol kembali ikon di pojok kiri atas',
    ikonKembali[0],
  );
  await pg.click('#btnHomeBack');
  cek(
    (await layar()) === 'name' && (await pg.inputValue('#nameInput')) === 'Sari',
    'tombol kembali di menu: ke halaman nama, nama lama tetap terisi',
  );
  const ikonNama = await pg.evaluate(() => {
    const b = document.getElementById('btnNameBack');
    const r = b.getBoundingClientRect();
    return { teks: b.textContent.trim(), kiri: r.left < innerWidth / 2, atas: r.top < 100 };
  });
  cek(
    ikonNama.teks === '' && ikonNama.kiri && ikonNama.atas,
    'halaman nama: tombol kembali ikon di pojok kiri atas',
    ikonNama,
  );
  await pg.fill('#nameInput', 'Sarah');
  await pg.press('#nameInput', 'Enter');
  cek(
    (await layar()) === 'home' && (await pg.textContent('#guestGreeting')) === 'Hai, Sarah!',
    'nama bisa diganti lewat tombol kembali',
  );
  await pg.evaluate(() => {
    __leura.state.guestActivity = 1; // the guest finished a message / quiz / photo (Thank you page)
    __leura.show('home');
  });
  cek(!(await pg.isVisible('#btnHomeBack')), 'setelah ada kegiatan: tombol kembali di menu hilang');
  await pg.evaluate(() => {
    __leura.state.guestActivity = 0;
    __leura.show('home');
  });
  // Touch screen: one tap reported twice must not go back twice (menu → name → Start); both buttons share a corner
  await pg.evaluate(() => {
    __leura.state.arrivalGuardMs = 700;
    document.getElementById('btnHomeBack').click();
    document.getElementById('btnNameBack').click(); // the ghost click
    __leura.state.arrivalGuardMs = 0;
  });
  cek((await layar()) === 'name', 'layar sentuh: ketukan ganda di tombol kembali hanya mundur satu halaman');
  await tunggu(750);
  await pg.click('#btnNameBack');
  cek((await layar()) === 'start', 'halaman nama: tombol kembali ke Start');
  await pg.evaluate(() => __leura.show('start'));
  cek(
    (await pg.evaluate(() => __leura.state.guestName)) === '' && !(await pg.isVisible('#guestGreeting')),
    'kembali ke Start menghapus nama tamu sebelumnya',
  );
  await pg.evaluate(() => {
    __leura.setLanguage('en');
  });
  await pg.click('#btnStart');
  cek(
    (await pg.textContent('#name h1')) === "What's your name?" &&
      (await pg.textContent('#nameKeyboard [data-k="enter"]')) === 'Continue',
    'halaman nama & keyboard ikut bahasa tamu',
  );
  const adminDiNama = await pg.evaluate(() => {
    const b = document.getElementById('btnAdminOpenName');
    const r = b.getBoundingClientRect();
    return { teks: b.textContent.trim(), w: r.width, h: r.height, kanan: r.right > innerWidth / 2 };
  });
  cek(
    adminDiNama.teks === '' && adminDiNama.w <= 48 && adminDiNama.h >= 44 && adminDiNama.kanan,
    'halaman nama: tombol Admin ikon kecil di pojok kanan',
    adminDiNama,
  );
  await pg.click('#btnAdminOpenName');
  await tunggu(300);
  cek((await layar()) === 'admin' && (await pg.isVisible('#adminPanel')), 'halaman nama: tombol Admin membuka Admin');
  await pg.click('#btnAdminBack');
  cek((await layar()) === 'name', 'Admin dibuka dari halaman nama: kembali ke halaman nama');
  await pg.evaluate(() => {
    __leura.setLanguage('id');
    __leura.show('admin');
    document.getElementById('adminLogin').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'flex';
  });
  await pg.locator('#setAskName').scrollIntoViewIfNeeded();
  cek(await pg.isChecked('#setAskName'), 'Admin: "Tanya nama tamu" menyala sebagai bawaan');
  await pg.click('#setAskName');
  await tunggu(200);
  cek(/"askName":false/.test((await log()).join(' ')), 'Admin: "Tanya nama tamu" bisa dimatikan');
  await pg.evaluate(() => __leura.show('start'));
  await pg.click('#btnStart');
  cek(
    (await layar()) === 'home' && !(await pg.isVisible('#guestGreeting')),
    'tanpa tanya nama: Start langsung ke Halaman Utama',
  );
  await pg.click('#btnHomeBack');
  cek((await layar()) === 'start', 'tanpa tanya nama: tombol kembali di menu langsung ke Start');
  await pg.click('#btnStart');
  // Touch screen: one finger tap reported twice must not press a menu button of the new page
  await pg.evaluate(() => {
    __leura.state.arrivalGuardMs = 700;
    __leura.show('start');
    document.getElementById('btnStart').click();
    document.getElementById('btnToPhoto').click(); // the ghost click
  });
  cek((await layar()) === 'home', 'layar sentuh: ketukan ganda di Start tidak langsung membuka Photo booth');
  cek(
    await pg.evaluate(() => document.getElementById('home').classList.contains('enter')),
    'Start → menu: menu muncul dengan animasi',
  );
  await tunggu(800);
  await tanpaJeda();
  await pg.click('#btnToPhoto');
  cek((await layar()) === 'photo', 'layar sentuh: setelah sesaat, tombol menu bisa ditekan lagi');
  await pg.evaluate(() => __leura.show('admin'));
  await pg.click('#setAskName');
  await tunggu(200);

  console.log('\n▶ Alur tamu: Terima kasih → menu → Selesai');
  await pg.evaluate(() => __leura.show('start'));
  await pg.click('#btnStart');
  await pg.fill('#nameInput', 'Rani');
  await pg.press('#nameInput', 'Enter');
  cek(
    (await layar()) === 'home' && !(await pg.isVisible('#btnGuestDone')),
    'belum ada kegiatan: tombol Selesai belum muncul',
  );
  await bersihkan();
  await pg.click('#btnToMessage');
  await pg.click('#btnMessageStart');
  await tunggu(4300);
  await pg.click('#btnFinish');
  await tungguLayar('thanks');
  await keMenu();
  cek(
    (await layar()) === 'home' && (await pg.textContent('#guestGreeting')) === 'Hai, Rani!',
    'kembali ke menu: nama tamu tetap (tidak perlu mengetik ulang)',
  );
  cek(
    (await pg.isVisible('#btnGuestDone')) && (await pg.textContent('#btnGuestDone')).trim() === 'Selesai',
    'setelah satu kegiatan: tombol Selesai muncul di menu',
  );
  await pg.click('#btnGuestDone');
  cek(
    (await layar()) === 'start' && (await pg.evaluate(() => __leura.state.guestName)) === '',
    'Selesai: kembali ke Start, nama tamu dihapus',
  );
  await pg.click('#btnStart');
  await pg.fill('#nameInput', 'Tono');
  await pg.press('#nameInput', 'Enter');
  cek(!(await pg.isVisible('#btnGuestDone')), 'tamu berikutnya: tombol Selesai tersembunyi lagi');
  await pg.evaluate(() => {
    __leura.state.guestActivity = 1;
    __leura.show('thanks');
  });
  await tungguLayar('home', 8000);
  cek(
    (await pg.evaluate(() => __leura.state.guestName)) === 'Tono',
    'Terima kasih dibiarkan: otomatis kembali ke menu, bukan ke Start',
  );

  console.log('\n▶ Riwayat sesi tetap ringan dengan banyak sesi');
  await pg.evaluate(() => {
    window.SESI_LAMA = SESI.slice();
    const t0 = Date.now();
    for (let i = 0; i < 400; i++)
      SESI.push({
        id: 1000 + i,
        time: new Date(t0 - i * 60000).toISOString(),
        label: 'photo',
        couple: 'Rina & Dimas',
        status: 'photo',
        photos: 4,
        file: `F${i}_hasil.jpg`,
      });
    window.NTHUMB = 0;
    window.THUMB_URL = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    // count full redraws of the list (rows replaced in #rwList itself; thumbnails only change inside a row)
    window.NGAMBAR = 0;
    new MutationObserver(() => window.NGAMBAR++).observe(document.getElementById('histList'), { childList: true });
    __leura.show('admin');
  });
  await pg.click('#btnHistory');
  await tunggu(800);
  const nBaris = await pg.locator('#histList .hist-row').count();
  cek(
    nBaris === 60 &&
      (await pg.isVisible('#histMore')) &&
      /\(\d+ more sessions\)/.test(await pg.textContent('#histMore')),
    'daftar ditampilkan per 60 sesi + tombol "Tampilkan lebih banyak"',
    nBaris,
  );
  const nThumb = await pg.evaluate(() => window.NTHUMB);
  cek(nThumb > 0 && nThumb < 40, 'gambar kecil hanya dimuat untuk baris yang terlihat (bukan 400)', nThumb);
  cek(
    (await pg.locator('#histList .hist-row .hist-icon img').count()) === nThumb,
    'gambar kecil langsung dipasang ke barisnya',
  );
  const redraws = await pg.evaluate(() => window.NGAMBAR);
  cek(redraws >= 1 && redraws <= 2, 'daftar tidak digambar ulang setiap gambar kecil selesai', redraws);
  await pg.click('#histMore');
  await tunggu(300);
  cek((await pg.locator('#histList .hist-row').count()) === 120, 'Tampilkan lebih banyak: 60 sesi berikutnya');
  await pg.evaluate(() => {
    const b = document.getElementById('history').querySelector('.sheet-body');
    b.scrollTop = b.scrollHeight;
  });
  await tunggu(500);
  cek((await pg.evaluate(() => window.NTHUMB)) > nThumb, 'menggulir ke bawah memuat gambar kecil berikutnya');
  await pg.evaluate(() => {
    SESI.length = 0;
    SESI.push(...window.SESI_LAMA);
    window.THUMB_URL = null;
  });
  await pg.click('#histBack');
  await tunggu(200);

  console.log('\n▶ Catatan aplikasi di Admin');
  await pg.evaluate(() => {
    __leura.show('admin');
    document.getElementById('adminLogin').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'flex';
  });
  await pg.locator('#btnViewLog').scrollIntoViewIfNeeded();
  await pg.click('#btnViewLog');
  await tunggu(200);
  cek(
    (await pg.isVisible('#dlgLog pre')) &&
      /0x8208/.test(await pg.textContent('#dlgLog pre')) &&
      /2026-11-06/.test(await pg.textContent('#dlgLog h2')),
    'Lihat catatan: isi catatan hari ini tampil',
  );
  await pg.click('#dlgLogSave');
  await tunggu(200);
  cek(
    (await log()).includes('simpan catatan') &&
      /Log saved: Leura-catatan-2026-11-06\.txt/.test(await pg.textContent('#notice')) &&
      (await pg.locator('#dlgLog').count()) === 0,
    'Simpan catatan: file tersimpan + pemberitahuan',
  );

  console.log('\n▶ Kunci Admin');
  await pg.evaluate(() => {
    __leura.show('home');
  });
  await pg.click('#btnAdminOpen');
  await tunggu(300);
  await pg.locator('#btnLockAdmin').scrollIntoViewIfNeeded();
  await pg.click('#btnLockAdmin');
  await tunggu(200);
  cek((await layar()) === 'home', 'Kunci Admin: kembali ke Halaman Utama');
  await pg.click('#btnAdminOpen');
  await tunggu(200);
  cek(
    (await pg.isVisible('#adminLogin')) && !(await pg.isVisible('#adminPanel')),
    'setelah dikunci, Admin harus login lagi',
  );
  await pg.fill('#uid', 'leura');
  await pg.fill('#pw', '1234');
  await pg.click('#btnLogin');
  await tunggu(300);
  cek(await pg.isVisible('#adminPanel'), 'login lagi berhasil');

  console.log('\n▶ Tutup aplikasi dari Admin');
  await pg.evaluate(() => {
    __leura.show('admin');
    document.getElementById('adminLogin').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'flex';
  });
  await bersihkan();
  await pg.locator('#btnQuitApp').scrollIntoViewIfNeeded();
  await pg.click('#btnQuitApp');
  await tunggu(200);
  cek(
    (await pg.isVisible('#dlgQuit')) && (await pg.locator('#dlgQuit li').count()) === 0,
    'tombol Tutup aplikasi meminta konfirmasi',
  );
  await pg.click('#dlgQuitCancel');
  await tunggu(100);
  cek(
    (await pg.locator('#dlgQuit').count()) === 0 && !(await log()).includes('tutup aplikasi'),
    'Batal: aplikasi tidak ditutup',
  );
  await pg.evaluate(() => {
    window.TUTUP = { copying: 1, processing: 0, photos: 2 };
  });
  await pg.click('#btnQuitApp');
  await tunggu(200);
  const peringatan = await pg.textContent('#dlgQuit ul');
  cek(
    /1 video\(s\) still copying/.test(peringatan) &&
      /2 QR photo\(s\) not sent yet/.test(peringatan) &&
      !/still processing/.test(peringatan),
    'peringatan video yang disalin & foto QR yang belum terkirim',
    peringatan,
  );
  await pg.click('#dlgQuitYes');
  await tunggu(200);
  cek(
    (await log()).includes('tutup aplikasi') && /Closing the app/.test(await pg.textContent('#dlgQuit')),
    'Ya: aplikasi ditutup lewat jalur resmi',
  );
  await pg.evaluate(() => document.getElementById('dlgQuit').remove());
  await pg.evaluate(() => {
    window.TUTUP = null;
    __leura.show('home');
    window.MINTA_TUTUP();
    window.MINTA_TUTUP();
  });
  await tunggu(300);
  cek(
    (await pg.locator('#dlgQuit').count()) === 1 && /Quit the app\?/.test(await pg.textContent('#dlgQuit h2')),
    'tombol ✕ / ⌘Q: dialog Tutup aplikasi muncul (sekali, walau ditekan dua kali)',
  );
  await pg.click('#dlgQuitCancel');
  await tunggu(100);
  cek((await pg.locator('#dlgQuit').count()) === 0, 'tombol ✕ lalu Batal: aplikasi tetap terbuka');

  console.log('\n▶ Cetak foto: tamu memilih jumlah lembar');
  await pg.evaluate(() => {
    TPL.length = 0; // built-in Grid 2×2: its print QR is at 980,1580 (180 px)
    Object.assign(UNG.st, { enabled: true, url: 'https://leura-foto.uji.workers.dev', hasKey: true });
    __leura.applySettings({
      ...__leura.state.cfg,
      photoCountdown: 2,
      photoPreview: 0,
      photoFlash: false,
      printEnabled: true,
      printMaxCopies: 3,
    });
    __leura.setLanguage('id');
    __leura.show('home');
  });
  // Dark pixels on the QR layer of the Edit photo page (the QR the print will have)
  const qrDiEdit = () =>
    pg.evaluate(() => {
      const c = document.getElementById('peQr'),
        d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0 && d[i - 1] < 60) dark++;
      return dark;
    });
  let qrTerlihat = 0;
  const sesiFoto = async () => {
    await pg.click('#btnToPhoto');
    await pg.click('#pbStart');
    await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 });
    await pg.click('#pbFinish');
    await tunggu(500);
    qrTerlihat = await qrDiEdit();
    await pg.click('#peDone');
    await tungguLayar('printCopies');
  };
  await sesiFoto();
  cek(qrTerlihat > 100, 'Edit foto: QR cetak sudah terlihat di pratinjau', qrTerlihat);
  cek(
    (await pg.evaluate(() => document.getElementById('pcPhoto').src.startsWith('data:image/jpeg'))) &&
      (await pg.isVisible('#pcPhoto')),
    'Selesai → halaman "Mau cetak berapa lembar?" dengan foto tamu',
  );
  cek(
    (await pg.textContent('#pcCount')) === '1' &&
      (await pg.textContent('#pcUnit')) === 'lembar' &&
      (await pg.isDisabled('#pcMinus')),
    'mulai dari 1 lembar, tombol − mati',
  );
  cek(
    (await pg.evaluate(() => getComputedStyle(document.getElementById('pcPhoto')).animationName)) === 'pcPhotoIn',
    'foto masuk dengan animasi',
  );
  for (let i = 0; i < 4; i++) await pg.click('#pcPlus', { force: true });
  cek(
    (await pg.textContent('#pcCount')) === '3' && (await pg.isDisabled('#pcPlus')),
    'paling banyak sesuai batas Admin (3), tombol + mati',
  );
  await pg.click('#pcMinus');
  cek(
    (await pg.textContent('#pcCount')) === '2' &&
      (await pg.evaluate(() => document.getElementById('pcCount').classList.contains('down'))),
    'tombol − mengurangi (angka bergulir turun)',
  );
  await pg.click('#pcPrint');
  await tunggu(100);
  cek(
    await pg.evaluate(() => document.getElementById('printCopies').classList.contains('to-print')),
    'Cetak: foto turun keluar dengan animasi',
  );
  await tungguLayar('thanks');
  const cetak = await pg.evaluate(() => ({ ...window.CETAK, image: window.CETAK.image.length }));
  cek(cetak.copies === 2 && cetak.layout === 'portrait' && cetak.image > 1000, '2 lembar dikirim ke printer', cetak);
  cek(
    (await pg.textContent('#thanksMsg')) === 'Fotomu sudah tersimpan dan sedang dicetak.' &&
      (await pg.isVisible('#thanksPhoto')),
    'Terima kasih: foto tersimpan & sedang dicetak',
  );
  // QR only on the print: dark finder square inside the white quiet zone, at the layout's QR spot
  const piksel = await pg.evaluate(async () => {
    const bmp = await createImageBitmap(new Blob([window.CETAK.image], { type: 'image/jpeg' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height),
      g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const at = (x, y) => g.getImageData(x, y, 1, 1).data[0];
    // Top-left finder pattern: dark ring, white ring, dark centre (same spots for QR version 3 and 4)
    return {
      w: bmp.width,
      h: bmp.height,
      quiet: at(983, 1583),
      ring: at(1000, 1600),
      gap: at(1005, 1605),
      centre: at(1013, 1613),
    };
  });
  cek(
    piksel.w === 1200 &&
      piksel.h === 1800 &&
      piksel.quiet > 200 &&
      piksel.ring < 60 &&
      piksel.gap > 200 &&
      piksel.centre < 60,
    'foto cetak memuat QR di tempatnya (foto digital tanpa QR)',
    piksel,
  );
  await keMenu();
  await sesiFoto();
  await pg.evaluate(() => (window.CETAK = null));
  await pg.click('#pcSkip');
  await tungguLayar('thanks');
  cek(
    (await pg.evaluate(() => window.CETAK)) === null &&
      (await pg.textContent('#thanksMsg')) === 'Fotomu sudah tersimpan.',
    'Tidak usah cetak: tidak ada yang dicetak',
  );
  await keMenu();
  await pg.evaluate(() => __leura.applySettings({ ...__leura.state.cfg, printEnabled: false }));
  await pg.click('#btnToPhoto');
  await pg.click('#pbStart');
  await pg.waitForSelector('#pbFinish', { state: 'visible', timeout: 40000 });
  await pg.click('#pbFinish');
  await tunggu(500);
  cek((await qrDiEdit()) === 0, 'cetak mati: tidak ada QR di Edit foto');
  await pg.click('#peDone');
  await tungguLayar('thanks');
  await keMenu();

  console.log('\n▶ Aplikasi dibuka lagi: Admin harus login lagi');
  await pg.evaluate(() => {
    __leura.show('home');
  });
  await pg.click('#btnAdminOpen');
  await tunggu(200);
  cek(await pg.isVisible('#adminPanel'), 'sebelum ditutup: Admin masih terbuka tanpa login');
  await pg.reload();
  await tunggu(1200);
  await tanpaJeda();
  await pg.evaluate(() => __leura.show('home'));
  await pg.click('#btnAdminOpen');
  await tunggu(200);
  cek(
    (await pg.isVisible('#adminLogin')) && !(await pg.isVisible('#adminPanel')),
    'setelah aplikasi dibuka lagi: Admin minta login',
  );

  console.log('\n▶ Tidak ada error di halaman');
  cek(errors.length === 0, 'tidak ada error JavaScript', errors);

  await evidenceSaved;
  await browser.close();
  await server.close();
  const h = hasil();
  console.log(`\n${h.gagal ? '✗' : '✓'} Uji tampilan: ${h.lulus} lulus, ${h.gagal} gagal`);
  process.exit(h.gagal ? 1 : 0);
}
main().catch(async e => {
  console.log('Uji berhenti: ' + e.message);
  await evidenceSaved;
  await saveEvidence('stopped');
  process.exit(1);
});
