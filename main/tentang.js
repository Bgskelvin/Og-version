/* =====================================================================
   tentang.js — Admin → App → About: versi aplikasi & lisensi pihak ketiga
   - Leura.app (installer): versi dari package.json, lisensi di
     Contents/Resources/THIRD-PARTY-NOTICES.txt + kamera-sony/bin/licenses/
   - npm start (folder kode): ditandai "development", plus nama branch Git
   ===================================================================== */
const { ipcMain, app, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const fileLisensi = () => (app.isPackaged
  ? path.join(process.resourcesPath, 'THIRD-PARTY-NOTICES.txt')
  : path.join(AKAR, 'THIRD-PARTY-NOTICES.txt'));

// Nama branch Git (hanya saat dijalankan dari folder kode), dibaca langsung dari .git/HEAD
function branchGit() {
  try {
    const head = fs.readFileSync(path.join(AKAR, '.git', 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref: refs\/heads\/(.+)$/);
    return m ? m[1] : head.slice(0, 7);
  } catch (e) { return ''; }
}

function info() {
  return { versi: app.getVersion(), terpasang: !!app.isPackaged, branch: app.isPackaged ? '' : branchGit(),
           electron: process.versions.electron, lisensi: fs.existsSync(fileLisensi()) };
}

function daftarkan() {
  ipcMain.handle('app-info', () => info());
  ipcMain.handle('buka-lisensi', async () => {
    const f = fileLisensi();
    if (!fs.existsSync(f)) return { error: 'License file not found.' };
    const err = await shell.openPath(f);
    return err ? { error: err } : { ok: true };
  });
}

module.exports = { daftarkan, info };
