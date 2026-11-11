/* =====================================================================
   about.js — Admin → App → About: app version & third-party licenses
   - Leura.app (installer): version from package.json, licenses in
     Contents/Resources/THIRD-PARTY-NOTICES.txt + kamera-sony/bin/licenses/
   - npm start (code folder): marked "development", plus the Git branch name
   ===================================================================== */
const { ipcMain, app, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const licenseFile = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'THIRD-PARTY-NOTICES.txt')
    : path.join(ROOT, 'THIRD-PARTY-NOTICES.txt');

// Git branch name (only when run from the code folder), read straight from .git/HEAD
function gitBranch() {
  try {
    const head = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref: refs\/heads\/(.+)$/);
    return m ? m[1] : head.slice(0, 7);
  } catch {
    return '';
  }
}

function info() {
  return {
    versi: app.getVersion(),
    terpasang: !!app.isPackaged,
    branch: app.isPackaged ? '' : gitBranch(),
    electron: process.versions.electron,
    lisensi: fs.existsSync(licenseFile()),
  };
}

function register() {
  ipcMain.handle('app-info', () => info());
  ipcMain.handle('buka-lisensi', async () => {
    const f = licenseFile();
    if (!fs.existsSync(f)) return { error: 'License file not found.' };
    const err = await shell.openPath(f);
    return err ? { error: err } : { ok: true };
  });
}

module.exports = { register, info };
