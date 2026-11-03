/* =====================================================================
   pengaturan.js — pengaturan dari Admin (settings.json), login Admin,
   dan folder penyimpanan
   ===================================================================== */
const { ipcMain, dialog, shell } = require('electron');
const crypto = require('crypto');
const { config, defaultDir, readSettings, writeSettings, getOutDir, usableDir } = require('./penyimpanan');
const { getWin } = require('./jendela-aktif');

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

function daftarkan() {
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
