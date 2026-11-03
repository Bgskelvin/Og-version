const { app, BrowserWindow, ipcMain, session, systemPreferences, shell, dialog, powerSaveBlocker, Menu } = require('electron');

// ---------- Hanya satu jendela aplikasi ----------
// Kalau ikon diklik lagi saat aplikasi sudah jalan, jendela yang ada dimunculkan,
// bukan membuka aplikasi kedua yang berebut kamera dan file data.
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
const DEV = process.argv.includes('--dev');   // npx electron main.js --dev  -> menu Reload & DevTools aktif
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ---------- Konfigurasi ---------- */
const bundledCfg = path.join(__dirname, 'config.json');
const configPath = app.isPackaged ? path.join(app.getPath('userData'), 'config.json') : bundledCfg;
if (app.isPackaged && !fs.existsSync(configPath)) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.copyFileSync(bundledCfg, configPath);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

/* ---------- Lokasi data ---------- */
const userData = app.getPath('userData');
const defaultDir = path.join(app.getPath('documents'), 'VideoboothRecordings');
const settingsPath = path.join(userData, 'settings.json');
const sessionsPath = path.join(userData, 'sessions.json');
fs.mkdirSync(userData, { recursive: true });

function tryRead(p) {
  try { return { ok: true, data: JSON.parse(fs.readFileSync(p, 'utf8')) }; }
  catch (e) { return { ok: false, missing: e.code === 'ENOENT' }; }
}
// Baca file; kalau rusak, pakai cadangan (.bak). File rusak tidak pernah dibuang diam-diam.
function readJSON(p, fallback) {
  const a = tryRead(p);
  if (a.ok) return a.data;
  const b = tryRead(p + '.bak');
  if (b.ok) { if (!a.missing) console.log('File rusak, memakai cadangan: ' + p); return b.data; }
  if (!a.missing) {
    console.log('File rusak tanpa cadangan, salinannya disimpan: ' + p);
    try { fs.copyFileSync(p, p + '.corrupt-' + Date.now()); } catch (e) {}
  }
  return fallback;
}
// Tulis aman: tulis ke file sementara, simpan versi lama sebagai .bak, lalu ganti sekaligus.
// Kalau listrik mati di tengah jalan, file lama atau cadangannya tetap utuh.
function writeJSON(p, data) {
  const tmp = p + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (tryRead(p).ok) { try { fs.copyFileSync(p, p + '.bak'); } catch (e) {} }
  try { fs.renameSync(tmp, p); }
  catch (e) { fs.copyFileSync(tmp, p); try { fs.unlinkSync(tmp); } catch (e2) {} }  // cadangan jika rename diblokir (mis. antivirus)
}
const readSettings = () => readJSON(settingsPath, {});
const writeSettings = s => writeJSON(settingsPath, s);
const readSessions = () => readJSON(sessionsPath, []);
const writeSessions = l => writeJSON(sessionsPath, l);

// Pindahkan riwayat sesi versi lama (dulu disimpan di folder rekaman)
const oldSessions = path.join(defaultDir, 'sessions.json');
if (!fs.existsSync(sessionsPath) && fs.existsSync(oldSessions)) {
  const old = readJSON(oldSessions, []);
  old.forEach(s => { s.dir = s.dir || defaultDir; s.id = s.id || Date.parse(s.time) || Date.now(); });
  writeSessions(old);
}

/* ---------- Data couple ---------- */
const couplesPath = path.join(userData, 'couples.json');
const MAX_Q = 10;
function readCouples() {
  let d = readJSON(couplesPath, null);
  if (!d || !Array.isArray(d.couples)) {
    // Pertama kali: ambil couple dari config.json sebagai data awal
    const first = {
      id: 'c' + Date.now(),
      name: config.couple || 'Couple Baru',
      welcome: config.welcome || '',
      questions: (config.quiz || []).slice(0, MAX_Q)
    };
    d = { activeId: first.id, couples: [first] };
    writeCouples(d);
  }
  if (!d.couples.find(c => c.id === d.activeId)) d.activeId = d.couples[0] ? d.couples[0].id : null;
  return d;
}
function writeCouples(d) { writeJSON(couplesPath, d); }
function cleanCouple(c) {
  return {
    id: c.id || 'c' + Date.now(),
    name: String(c.name || '').trim().slice(0, 80),
    welcome: String(c.welcome || '').trim().slice(0, 160),
    questions: (Array.isArray(c.questions) ? c.questions : [])
      .map(q => String(q || '').trim().slice(0, 200)).filter(Boolean).slice(0, MAX_Q)
  };
}

const getOutDir = () => readSettings().outDir || defaultDir;

/* ---------- Pengaturan (diubah dari Admin, disimpan di settings.json) ---------- */
const LIMITS = { quizSeconds: [10, 300], quizRounds: [1, 10] };
const clampInt = (v, [lo, hi], dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const isColor = v => /^#[0-9a-f]{6}$/i.test(String(v || ''));
function effective() {
  const s = readSettings();
  return {
    quizSeconds: clampInt(s.quizSeconds ?? config.quizSeconds, LIMITS.quizSeconds, 60),
    quizRounds: clampInt(s.quizRounds ?? config.quizRounds, LIMITS.quizRounds, 3),
    kiosk: typeof s.kiosk === 'boolean' ? s.kiosk : !!config.kiosk,
    accent: isColor(s.accent) ? s.accent : ((config.colors && isColor(config.colors.accent)) ? config.colors.accent : '#B08D57'),
    loginId: (s.login && s.login.id) || (config.login && config.login.id) || 'admin'
  };
}
// Password baru disimpan sebagai hash, bukan teks biasa
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
function checkLogin(id, pw) {
  const s = readSettings();
  if (s.login && s.login.hash) {
    const h = hashPw(pw, s.login.salt);
    return String(id).toLowerCase() === String(s.login.id).toLowerCase()
      && crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(s.login.hash, 'hex'));
  }
  const c = config.login || {};
  return String(id).toLowerCase() === String(c.id || '').toLowerCase() && String(pw) === String(c.password || '');
}

// Nama couple -> nama yang aman untuk folder & file di Windows dan Mac
function safeName(name) {
  const s = String(name || '')
    .replace(/[<>:"\/\\|?*\x00-\x1F]/g, '')   // karakter terlarang
    .replace(/\s+/g, ' ').trim()
    .replace(/[. ]+$/, '')                          // Windows: tidak boleh berakhir titik/spasi
    .slice(0, 60);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) ? s + '_' : s;
}
function activeCoupleName() {
  const d = readCouples();
  const c = d.couples.find(x => x.id === d.activeId);
  return c ? c.name : '';
}
function coupleDir(base, name) {
  const n = safeName(name);
  return n ? path.join(base, n) : base;
}
function usableDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return true; }
  catch (e) { return false; }
}
function updateSession(id, patch) {
  const list = readSessions();
  const s = list.find(x => x.id === id);
  if (s) { Object.assign(s, patch); writeSessions(list); }
}

/* ---------- FFmpeg: .webm -> .mp4 ---------- */
let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
} catch (e) {
  console.log('ffmpeg-static belum terpasang: rekaman tetap disimpan sebagai .webm');
}

let convChain = Promise.resolve();
function convert(id, webmPath) {
  if (!ffmpegPath) { updateSession(id, { status: 'webm' }); return; }
  convChain = convChain.then(() => new Promise(resolve => {
    const mp4 = webmPath.replace(/\.webm$/i, '.mp4');
    const p = spawn(ffmpegPath, [
      '-y', '-fflags', '+genpts', '-i', webmPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', mp4
    ], { stdio: 'ignore' });
    p.on('error', () => { updateSession(id, { status: 'failed' }); resolve(); });
    p.on('close', code => {
      try {
        if (code === 0 && fs.existsSync(mp4)) {
          const od = path.join(path.dirname(webmPath), 'original');
          fs.mkdirSync(od, { recursive: true });
          fs.renameSync(webmPath, path.join(od, path.basename(webmPath)));
          updateSession(id, { file: path.basename(mp4), status: 'done' });
        } else updateSession(id, { status: 'failed' });
      } catch (e) { updateSession(id, { status: 'failed' }); }
      resolve();
    });
  }));
}

/* ---------- IPC ---------- */
let win = null;
const recs = new Map();  // setiap rekaman punya ID sendiri, jadi dua rekaman tidak bisa tercampur
let recSeq = 0;
const pad = n => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

ipcMain.handle('get-config', () => {
  const e = effective();
  return { ...config, login: undefined, quizSeconds: e.quizSeconds, quizRounds: e.quizRounds, kiosk: e.kiosk,
    colors: { ...(config.colors || {}), accent: e.accent } };
});
ipcMain.handle('login', (e, id, pw) => checkLogin(id, pw));

ipcMain.handle('get-settings', () => effective());
ipcMain.handle('save-settings', (e, patch) => {
  const s = readSettings();
  if ('quizSeconds' in patch) s.quizSeconds = clampInt(patch.quizSeconds, LIMITS.quizSeconds, 60);
  if ('quizRounds' in patch) s.quizRounds = clampInt(patch.quizRounds, LIMITS.quizRounds, 3);
  if ('accent' in patch && isColor(patch.accent)) s.accent = patch.accent;
  if ('kiosk' in patch) {
    s.kiosk = !!patch.kiosk;
    if (win && !win.isDestroyed()) { win.setKiosk(s.kiosk); if (!s.kiosk) win.setFullScreen(false); }
  }
  writeSettings(s);
  return effective();
});
ipcMain.handle('change-login', (e, oldPw, newId, newPw) => {
  const id = String(newId || '').trim();
  if (!checkLogin(effective().loginId, oldPw)) return { error: 'Password lama salah.' };
  if (!id) return { error: 'ID tidak boleh kosong.' };
  if (String(newPw || '').length < 4) return { error: 'Password baru minimal 4 karakter.' };
  const salt = crypto.randomBytes(16).toString('hex');
  const s = readSettings();
  s.login = { id, salt, hash: hashPw(newPw, salt) };
  writeSettings(s);
  return { ok: true, id };
});
ipcMain.handle('get-sessions', () => readSessions());

ipcMain.handle('get-couples', () => readCouples());
ipcMain.handle('save-couple', (e, input) => {
  const c = cleanCouple(input || {});
  if (!c.name) return { error: 'Nama couple wajib diisi.' };
  if (!c.questions.length) return { error: 'Isi minimal 1 pertanyaan.' };
  const d = readCouples();
  const i = d.couples.findIndex(x => x.id === c.id);
  if (i >= 0) d.couples[i] = c; else d.couples.push(c);
  if (!d.activeId) d.activeId = c.id;
  writeCouples(d);
  return { ok: true, couple: c, data: d };
});
ipcMain.handle('delete-couple', (e, id) => {
  const d = readCouples();
  if (d.couples.length <= 1) return { error: 'Minimal harus ada 1 couple.' };
  d.couples = d.couples.filter(c => c.id !== id);
  if (d.activeId === id) d.activeId = d.couples[0].id;
  writeCouples(d);
  return { ok: true, data: d };
});
ipcMain.handle('set-active-couple', (e, id) => {
  const d = readCouples();
  if (!d.couples.find(c => c.id === id)) return { error: 'Couple tidak ditemukan.' };
  d.activeId = id;
  writeCouples(d);
  return { ok: true, data: d };
});
ipcMain.handle('open-folder', () => { const d = getOutDir(); usableDir(d); return shell.openPath(d); });
ipcMain.handle('open-couple-folder', () => {
  const d = coupleDir(getOutDir(), activeCoupleName());
  if (!usableDir(d)) return 'Folder tidak tersedia';
  return shell.openPath(d);
});

ipcMain.handle('get-outdir', () => {
  const dir = getOutDir();
  return { dir, isDefault: !readSettings().outDir, ok: usableDir(dir) };
});
ipcMain.handle('choose-outdir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Pilih folder penyimpanan', defaultPath: getOutDir(), properties: ['openDirectory', 'createDirectory']
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const dir = r.filePaths[0];
  if (!usableDir(dir)) return { error: 'Folder itu tidak bisa ditulisi. Pilih folder lain.' };
  const s = readSettings(); s.outDir = dir; writeSettings(s);
  return { dir };
});
ipcMain.handle('reset-outdir', () => { const s = readSettings(); delete s.outDir; writeSettings(s); return { dir: defaultDir }; });

ipcMain.handle('rec-start', (e, label) => {
  const name = activeCoupleName();
  let base = getOutDir(), fallback = false;
  if (!usableDir(base)) {
    base = defaultDir; fallback = true;
    console.log('Folder pilihan tidak tersedia, memakai folder default');
    if (!usableDir(base)) return { error: 'Folder penyimpanan tidak bisa ditulisi.' };
  }
  let dir = coupleDir(base, name);
  if (!usableDir(dir)) dir = base;
  const prefix = safeName(name) ? safeName(name) + '_' : '';
  let file = path.join(dir, `${prefix}${stamp()}_${label}.webm`);
  let n = 2;
  while (fs.existsSync(file)) file = path.join(dir, `${prefix}${stamp()}_${label}_${n++}.webm`);

  const id = ++recSeq;
  const sid = Date.now() * 1000 + (id % 1000);
  const rec = { id, sid, file, dir, label, error: null, stream: null, t0: Date.now() };
  try { rec.stream = fs.createWriteStream(file); }
  catch (err) { return { error: 'Tidak bisa membuat file rekaman: ' + err.message }; }
  // Catat sesi sejak awal dengan status "recording". Kalau aplikasi atau komputer mati di tengah
  // rekaman, sesi ini dikenali dan dipulihkan saat aplikasi dibuka lagi.
  try {
    const list = readSessions();
    list.push({ id: sid, time: new Date(rec.t0).toISOString(), label, file: path.basename(file), dir,
      couple: name, seconds: 0, status: 'recording' });
    writeSessions(list);
  } catch (err) { console.log('Gagal mencatat sesi: ' + err.message); }
  // Disk penuh / SSD tercabut: jangan crash, catat error dan beri tahu layar
  rec.stream.on('error', err => {
    if (rec.error) return;
    rec.error = err.message;
    console.log('Gagal menulis rekaman: ' + err.message);
    if (win && !win.isDestroyed()) win.webContents.send('rec-error', id, err.message);
  });
  recs.set(id, rec);
  return { id, file, fallback };
});

ipcMain.on('rec-chunk', (e, id, buf) => {
  const rec = recs.get(id);
  if (rec && !rec.error && rec.stream.writable) rec.stream.write(Buffer.from(buf));
});

function closeStream(rec) {
  return new Promise(res => {
    if (rec.stream.destroyed || rec.stream.writableEnded) return res();
    rec.stream.end(() => res());
    rec.stream.once('error', () => res());
  });
}

ipcMain.handle('rec-end', async (e, id, seconds, meta) => {
  const rec = recs.get(id);
  if (!rec) return null;
  recs.delete(id);
  await closeStream(rec);
  const sid = rec.sid;
  const ok = !rec.error;
  const patch = { seconds, status: !ok ? 'write-error' : (ffmpegPath ? 'processing' : 'webm'),
    ...(rec.error ? { error: rec.error } : {}), ...(meta || {}) };
  try {
    const list = readSessions();
    const s = list.find(x => x.id === sid);
    if (s) Object.assign(s, patch);
    else list.push({ id: sid, time: new Date(rec.t0).toISOString(), label: rec.label, file: path.basename(rec.file), dir: rec.dir, ...patch });
    writeSessions(list);
  } catch (err) { console.log('Gagal mencatat sesi: ' + err.message); }
  if (ok) convert(sid, rec.file);
  return { ok, file: rec.file, error: rec.error };
});

// Batalkan rekaman yang gagal dimulai: tutup dan hapus file yang belum berisi
ipcMain.handle('rec-abort', async (e, id) => {
  const rec = recs.get(id);
  if (!rec) return;
  recs.delete(id);
  await closeStream(rec);
  try { if (fs.statSync(rec.file).size < 1024) fs.unlinkSync(rec.file); } catch (err) {}
  try { writeSessions(readSessions().filter(x => x.id !== rec.sid)); } catch (err) {}
});

// Pulihkan rekaman yang terputus (aplikasi ditutup paksa, crash, atau listrik mati saat merekam).
// Potongan rekaman sudah tertulis ke disk setiap detik, jadi isinya bisa diselamatkan.
function recoverInterrupted() {
  const list = readSessions();
  const found = list.filter(s => s.status === 'recording');
  if (!found.length) return 0;
  let recovered = 0;
  for (const s of found) {
    const p = path.join(s.dir || defaultDir, s.file);
    let st = null;
    try { st = fs.statSync(p); } catch (e) {}
    if (!st || st.size < 1024) { s.status = 'lost'; continue; }   // file tidak ada / kosong
    s.recovered = true;
    s.seconds = Math.max(0, Math.round((st.mtimeMs - Date.parse(s.time)) / 1000));  // perkiraan durasi
    s.status = ffmpegPath ? 'processing' : 'webm';
    recovered++;
  }
  writeSessions(list);
  console.log(`Rekaman terputus dipulihkan: ${recovered} dari ${found.length}`);
  return recovered;
}
// Tutup rekaman yang masih terbuka dan selamatkan isinya (dipakai saat tampilan aplikasi crash)
async function rescueOpenRecordings() {
  for (const rec of [...recs.values()]) {
    recs.delete(rec.id);
    await closeStream(rec);
  }
  const n = recoverInterrupted();
  readSessions().filter(x => x.status === 'processing').forEach(x => {
    const p = path.join(x.dir || defaultDir, x.file);
    if (fs.existsSync(p)) convert(x.id, p);
  });
  return n;
}
let recoveredCount = 0;
ipcMain.handle('get-startup-info', () => { const r = { recovered: recoveredCount }; recoveredCount = 0; return r; });

/* ---------- Jendela ---------- */
app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('camera');
    await systemPreferences.askForMediaAccess('microphone');
  }
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media'));
  powerSaveBlocker.start('prevent-display-sleep'); // layar & PC tidak tidur selama aplikasi jalan

  // Pulihkan rekaman yang terputus, lalu lanjutkan konversi yang belum selesai
  recoveredCount = recoverInterrupted();
  readSessions().filter(s => s.status === 'processing').forEach(s => {
    const p = path.join(s.dir || defaultDir, s.file);
    if (fs.existsSync(p)) convert(s.id, p);
  });

  // ---------- Menu ----------
  // Tanpa menu "View": Cmd/Ctrl+R (muat ulang), DevTools, dan zoom tidak bisa tertekan tidak sengaja.
  // Di Mac tetap ada menu aplikasi (Cmd+Q untuk keluar) dan Edit (salin/tempel di kolom isian).
  const template = [];
  if (process.platform === 'darwin') template.push({ role: 'appMenu' }, { role: 'editMenu' });
  if (DEV) template.push({ label: 'Developer', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] });
  Menu.setApplicationMenu(template.length ? Menu.buildFromTemplate(template) : null);

  win = new BrowserWindow({
    width: 1280, height: 800,
    fullscreen: effective().kiosk, kiosk: effective().kiosk,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  const wc = win.webContents;
  wc.on('console-message', (e, level, msg) => console.log('[app]', msg));

  // Jangan pernah pindah halaman (mis. file atau link terseret ke jendela) dan jangan buka jendela baru
  const appUrl = require('url').pathToFileURL(path.join(__dirname, 'index.html')).href;
  wc.on('will-navigate', (e, url) => { if (url !== appUrl) e.preventDefault(); });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Kunci zoom (pinch di trackpad / layar sentuh, Ctrl+scroll)
  wc.setVisualZoomLevelLimits(1, 1);
  wc.on('zoom-changed', () => wc.setZoomFactor(1));
  // Kalau tampilan aplikasi crash, muat ulang otomatis supaya layar tidak tertinggal kosong
  wc.on('render-process-gone', async (e, d) => {
    if (d.reason === 'clean-exit') return;
    console.log('Tampilan aplikasi berhenti (' + d.reason + '), menyelamatkan rekaman lalu memuat ulang');
    try { recoveredCount = await rescueOpenRecordings(); } catch (err) { console.log(err.message); }
    setTimeout(() => { if (!win.isDestroyed()) wc.reload(); }, 1000);
  });

  win.loadFile('index.html');
});

// Klik ikon lagi saat aplikasi sudah terbuka: munculkan jendela yang ada
app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { for (const rec of recs.values()) { try { rec.stream.end(); } catch (e) {} } });
