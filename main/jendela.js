/* =====================================================================
   jendela.js — membuat jendela aplikasi, menu, dan pengaman navigasi
   ===================================================================== */
const { BrowserWindow, Menu } = require('electron');
const path = require('path');
const { effective } = require('./pengaturan');
const rekaman = require('./rekaman');
const { getWin, setWin } = require('./jendela-aktif');

function buatJendela(DEV) {
  // ---------- Menu ----------
  // Tanpa menu "View": Cmd/Ctrl+R (muat ulang), DevTools, dan zoom tidak bisa tertekan tidak sengaja.
  // Di Mac tetap ada menu aplikasi (Cmd+Q untuk keluar) dan Edit (salin/tempel di kolom isian).
  const template = [];
  if (process.platform === 'darwin') template.push({ role: 'appMenu' }, { role: 'editMenu' });
  if (DEV) template.push({ label: 'Developer', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] });
  Menu.setApplicationMenu(template.length ? Menu.buildFromTemplate(template) : null);

  const win = new BrowserWindow({
    width: 1280, height: 800,
    fullscreen: effective().kiosk, kiosk: effective().kiosk,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js') }
  });
  const wc = win.webContents;
  wc.on('console-message', (e, level, msg) => console.log('[app]', msg));

  // Jangan pernah pindah halaman (mis. file atau link terseret ke jendela) dan jangan buka jendela baru
  const appUrl = require('url').pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
  wc.on('will-navigate', (e, url) => { if (url !== appUrl) e.preventDefault(); });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Kunci zoom (pinch di trackpad / layar sentuh, Ctrl+scroll)
  wc.setVisualZoomLevelLimits(1, 1);
  wc.on('zoom-changed', () => wc.setZoomFactor(1));
  // Kalau tampilan aplikasi crash, muat ulang otomatis supaya layar tidak tertinggal kosong
  wc.on('render-process-gone', async (e, d) => {
    if (d.reason === 'clean-exit') return;
    console.log('Tampilan aplikasi berhenti (' + d.reason + '), menyelamatkan rekaman lalu memuat ulang');
    try { await rekaman.selamatkan(); } catch (err) { console.log(err.message); }
    setTimeout(() => { if (!win.isDestroyed()) wc.reload(); }, 1000);
  });

  setWin(win);
  win.loadFile(path.join(__dirname, '..', 'index.html'));
}

// Klik ikon lagi saat aplikasi sudah terbuka: munculkan jendela yang ada
function munculkan() {
  const win = getWin();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

module.exports = { buatJendela, munculkan };
