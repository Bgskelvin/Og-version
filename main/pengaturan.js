/* =====================================================================
   pengaturan.js — pengaturan dari Admin (settings.json), login Admin,
   dan folder penyimpanan
   ===================================================================== */
const { ipcMain, dialog, shell } = require('electron');
const crypto = require('crypto');
const { config, defaultDir, readSettings, writeSettings, getOutDir, usableDir } = require('./penyimpanan');
const { getWin } = require('./jendela-aktif');

/* ---------- Pengaturan (diubah dari Admin & halaman Pengaturan Videobooth/Photobooth) ---------- */
// Angka: [terkecil, terbesar, bawaan]. Saklar: nilai bawaan.
const ANGKA = {
  quizSeconds:     [10, 300, 60],   // Videobooth: detik menjawab per pertanyaan quiz
  quizRounds:      [1, 10, 3],      // Videobooth: jumlah pertanyaan per sesi quiz
  pesanCountdown:  [0, 10, 3],      // Videobooth: hitung mundur sebelum merekam pesan (0 = langsung)
  pesanMaxSeconds: [0, 600, 0],     // Videobooth: batas durasi pesan (0 = tanpa batas)
  photoCountdown:  [2, 10, 5],      // Photobooth: hitung mundur sebelum setiap foto
  photoPreview:    [0, 5, 2],       // Photobooth: detik pratinjau setelah jepret (0 = tanpa)
};
const SAKLAR = {
  enablePesan: true, enableQuiz: true,   // Videobooth: menu di Halaman Utama
  enablePhoto: true, photoFlash: true,   // Photobooth: menu & efek kilat layar
};
const MENU = ['enablePesan', 'enableQuiz', 'enablePhoto'];
const KAMERA = ['webcam', 'sony', 'sony-sim'];    // sumber kamera: webcam/HP, Sony lewat USB, Sony simulasi
const clampInt = (v, [lo, hi], dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const isColor = v => /^#[0-9a-f]{6}$/i.test(String(v || ''));
function effective() {
  const s = readSettings();
  return {
    ...Object.fromEntries(Object.entries(ANGKA).map(([k, [lo, hi, d]]) => [k, clampInt(s[k] ?? config[k], [lo, hi], d)])),
    ...Object.fromEntries(Object.entries(SAKLAR).map(([k, d]) => [k, typeof s[k] === 'boolean' ? s[k] : d])),
    kiosk: typeof s.kiosk === 'boolean' ? s.kiosk : !!config.kiosk,
    kamera: KAMERA.includes(s.kamera) ? s.kamera : 'webcam',
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

function daftarkan() {
  ipcMain.handle('get-config', () => {
    const e = effective();
    const { loginId, accent, ...booth } = e;
    return { ...config, login: undefined, ...booth, colors: { ...(config.colors || {}), accent } };
  });
  ipcMain.handle('login', (e, id, pw) => checkLogin(id, pw));

  ipcMain.handle('get-settings', () => effective());
  ipcMain.handle('save-settings', (e, patch) => {
    const s = readSettings();
    for (const [k, [lo, hi, d]] of Object.entries(ANGKA)) if (k in patch) s[k] = clampInt(patch[k], [lo, hi], d);
    for (const k of Object.keys(SAKLAR)) if (k in patch) s[k] = !!patch[k];
    // Minimal satu menu harus tetap tampil di Halaman Utama
    const now = effective(), next = { ...now, ...Object.fromEntries(MENU.filter(k => k in s).map(k => [k, s[k]])) };
    if (!MENU.some(k => next[k])) return { ...now, error: 'Minimal satu menu harus tetap tampil di Halaman Utama.' };
    if ('accent' in patch && isColor(patch.accent)) s.accent = patch.accent;
    if ('kamera' in patch && KAMERA.includes(patch.kamera)) {
      s.kamera = patch.kamera;
      require('./kamera-sony').setel(s.kamera);
    }
    if ('kiosk' in patch) {
      s.kiosk = !!patch.kiosk;
      const win = getWin();
      if (win) { win.setKiosk(s.kiosk); if (!s.kiosk) win.setFullScreen(false); }
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

  ipcMain.handle('open-folder', () => { const d = getOutDir(); usableDir(d); return shell.openPath(d); });
  ipcMain.handle('get-outdir', () => {
    const dir = getOutDir();
    return { dir, isDefault: !readSettings().outDir, ok: usableDir(dir) };
  });
  ipcMain.handle('choose-outdir', async () => {
    const r = await dialog.showOpenDialog(getWin(), {
      title: 'Pilih folder penyimpanan', defaultPath: getOutDir(), properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const dir = r.filePaths[0];
    if (!usableDir(dir)) return { error: 'Folder itu tidak bisa ditulisi. Pilih folder lain.' };
    const s = readSettings(); s.outDir = dir; writeSettings(s);
    return { dir };
  });
  ipcMain.handle('reset-outdir', () => { const s = readSettings(); delete s.outDir; writeSettings(s); return { dir: defaultDir }; });
}

module.exports = { effective, checkLogin, daftarkan };
