/* =====================================================================
   settings.js — settings from Admin (settings.json), Admin login,
   and the storage folder
   ===================================================================== */
const { ipcMain, dialog, shell } = require('electron');
const crypto = require('crypto');
const { config, defaultDir, readSettings, writeSettings, getOutDir, usableDir } = require('./storage');
const { getWin } = require('./active-window');

/* ---------- Settings (changed from Admin & the Videobooth/Photobooth settings pages) ---------- */
// Numbers: [smallest, largest, default]. Switches: default value.
// The key names are stored in settings.json and shared with the UI.
const NUMBERS = {
  quizSeconds: [10, 300, 60], // Videobooth: seconds to answer each quiz question
  quizRounds: [1, 10, 3], // Videobooth: number of questions per quiz session
  pesanCountdown: [0, 10, 3], // Videobooth: countdown before recording a message (0 = right away)
  pesanMaxSeconds: [0, 600, 0], // Videobooth: message length limit (0 = no limit)
  photoCountdown: [2, 10, 5], // Photobooth: countdown before each photo
  photoPreview: [0, 5, 2], // Photobooth: preview seconds after each shot (0 = none)
};
const SWITCHES = {
  enablePesan: true,
  enableQuiz: true, // Videobooth: menu on the main page
  enablePhoto: true,
  photoFlash: true, // Photobooth: screen flash effect
  tanyaNama: true, // "What's your name?" screen after Start; the guest name becomes the file name
};
const MENU = ['enablePesan', 'enableQuiz', 'enablePhoto'];
const CAMERA_SOURCES = ['webcam', 'sony', 'sony-sim']; // webcam/phone, Sony over USB, simulated Sony
const LANGUAGES = ['en', 'id']; // guest screen language (Admin is always English); default: English
const clampInt = (v, [lo, hi], dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const isColor = v => /^#[0-9a-f]{6}$/i.test(String(v || ''));
function effective() {
  const s = readSettings();
  return {
    ...Object.fromEntries(
      Object.entries(NUMBERS).map(([k, [lo, hi, d]]) => [k, clampInt(s[k] ?? config[k], [lo, hi], d)]),
    ),
    ...Object.fromEntries(Object.entries(SWITCHES).map(([k, d]) => [k, typeof s[k] === 'boolean' ? s[k] : d])),
    kiosk: typeof s.kiosk === 'boolean' ? s.kiosk : !!config.kiosk,
    kamera: CAMERA_SOURCES.includes(s.kamera) ? s.kamera : 'webcam',
    bahasa: LANGUAGES.includes(s.bahasa) ? s.bahasa : 'en',
    accent: isColor(s.accent)
      ? s.accent
      : config.colors && isColor(config.colors.accent)
        ? config.colors.accent
        : '#B08D57',
    loginId: (s.login && s.login.id) || (config.login && config.login.id) || 'admin',
  };
}
// A new password is stored as a hash, not as plain text
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
function checkLogin(id, pw) {
  const s = readSettings();
  if (s.login && s.login.hash) {
    const h = hashPw(pw, s.login.salt);
    return (
      String(id).toLowerCase() === String(s.login.id).toLowerCase() &&
      crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(s.login.hash, 'hex'))
    );
  }
  const c = config.login || {};
  return String(id).toLowerCase() === String(c.id || '').toLowerCase() && String(pw) === String(c.password || '');
}

function register() {
  ipcMain.handle('get-config', () => {
    const e = effective();
    const { loginId, accent, ...booth } = e;
    return { ...config, login: undefined, ...booth, colors: { ...(config.colors || {}), accent } };
  });
  ipcMain.handle('login', (e, id, pw) => {
    const ok = checkLogin(id, pw);
    require('./log').write(
      ok ? 'Admin login succeeded' : 'Admin login failed (wrong ID or password)',
      ok ? 'info' : 'warn',
    );
    return ok;
  });

  ipcMain.handle('get-settings', () => effective());
  ipcMain.handle('save-settings', (e, patch) => {
    const s = readSettings();
    for (const [k, [lo, hi, d]] of Object.entries(NUMBERS)) if (k in patch) s[k] = clampInt(patch[k], [lo, hi], d);
    for (const k of Object.keys(SWITCHES)) if (k in patch) s[k] = !!patch[k];
    // At least one menu option must stay on the main page
    const now = effective(),
      next = { ...now, ...Object.fromEntries(MENU.filter(k => k in s).map(k => [k, s[k]])) };
    if (!MENU.some(k => next[k])) return { ...now, error: 'At least one option must stay on the main menu.' };
    if ('accent' in patch && isColor(patch.accent)) s.accent = patch.accent;
    if ('bahasa' in patch && LANGUAGES.includes(patch.bahasa)) s.bahasa = patch.bahasa;
    if ('kamera' in patch && CAMERA_SOURCES.includes(patch.kamera)) {
      s.kamera = patch.kamera;
      require('./sony-camera').setSource(s.kamera);
    }
    if ('kiosk' in patch) {
      s.kiosk = !!patch.kiosk;
      const win = getWin();
      if (win) {
        win.setKiosk(s.kiosk);
        if (!s.kiosk) win.setFullScreen(false);
      }
    }
    writeSettings(s);
    return effective();
  });
  ipcMain.handle('change-login', (e, oldPw, newId, newPw) => {
    const id = String(newId || '').trim();
    if (!checkLogin(effective().loginId, oldPw)) return { error: 'Current password is wrong.' };
    if (!id) return { error: 'ID cannot be empty.' };
    if (String(newPw || '').length < 4) return { error: 'The new password needs at least 4 characters.' };
    const salt = crypto.randomBytes(16).toString('hex');
    const s = readSettings();
    s.login = { id, salt, hash: hashPw(newPw, salt) };
    writeSettings(s);
    return { ok: true, id };
  });

  ipcMain.handle('open-folder', () => {
    const d = getOutDir();
    usableDir(d);
    return shell.openPath(d);
  });
  ipcMain.handle('get-outdir', () => {
    const dir = getOutDir();
    return { dir, isDefault: !readSettings().outDir, ok: usableDir(dir) };
  });
  ipcMain.handle('choose-outdir', async () => {
    const r = await dialog.showOpenDialog(getWin(), {
      title: 'Choose storage folder',
      defaultPath: getOutDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const dir = r.filePaths[0];
    if (!usableDir(dir)) return { error: 'That folder is not writable. Choose another folder.' };
    const s = readSettings();
    s.outDir = dir;
    writeSettings(s);
    return { dir };
  });
  ipcMain.handle('reset-outdir', () => {
    const s = readSettings();
    delete s.outDir;
    writeSettings(s);
    return { dir: defaultDir };
  });
}

module.exports = { effective, checkLogin, register };
