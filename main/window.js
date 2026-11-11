/* =====================================================================
   window.js — creates the app window, the menu, and navigation guards
   ===================================================================== */
const { BrowserWindow, Menu } = require('electron');
const path = require('path');
const { effective } = require('./settings');
const recording = require('./recording');
const { getWin, setWin } = require('./active-window');
const log = require('./log');

function createWindow(DEV) {
  // ---------- Menu ----------
  // No "View" menu: Cmd/Ctrl+R (reload), DevTools and zoom can't be pressed by accident.
  // On Mac there is still the app menu (Cmd+Q to quit) and Edit (copy/paste in text fields).
  const template = [];
  if (process.platform === 'darwin') template.push({ role: 'appMenu' }, { role: 'editMenu' });
  if (DEV) template.push({ label: 'Developer', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] });
  Menu.setApplicationMenu(template.length ? Menu.buildFromTemplate(template) : null);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: effective().kiosk,
    kiosk: effective().kiosk,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js') },
  });
  const wc = win.webContents;
  // Messages from the UI go into the log; errors (red in DevTools) are marked ✗
  // Newer Electron: all details are on the event object (e.level, e.message, e.lineNumber, e.sourceId)
  // (one parameter only: if the listener takes more, Electron prints a "deprecated" warning)
  wc.on('console-message', (e, ...legacy) => {
    const [lv, text, line, src] = e && e.message != null ? [e.level, e.message, e.lineNumber, e.sourceId] : legacy;
    const err = lv === 3 || lv === 'error';
    log.write(
      '[ui] ' + text + (err && src ? ` (${String(src).split('/').pop()}:${line})` : ''),
      err ? 'error' : lv === 2 || lv === 'warning' ? 'warn' : 'info',
    );
  });

  // Never navigate away (e.g. a file or link dragged onto the window) and never open new windows
  const appUrl = require('url').pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
  wc.on('will-navigate', (e, url) => {
    if (url !== appUrl) e.preventDefault();
  });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Lock zoom (trackpad / touchscreen pinch, Ctrl+scroll).
  // Set after the page has loaded: called too early, Electron refuses
  // ("Render frame was disposed before WebFrameMain could be accessed").
  wc.on('did-finish-load', () => {
    Promise.resolve(wc.setVisualZoomLevelLimits(1, 1)).catch(() => {});
  });
  wc.on('zoom-changed', () => wc.setZoomFactor(1));
  // If the app UI crashes, reload it automatically so the screen isn't left blank
  wc.on('render-process-gone', async (e, d) => {
    if (d.reason === 'clean-exit') return;
    log.error('App UI stopped (' + d.reason + ', code ' + d.exitCode + '), rescuing recordings and reloading');
    try {
      await recording.rescue();
    } catch (err) {
      console.log(err.message);
    }
    setTimeout(() => {
      if (!win.isDestroyed()) wc.reload();
    }, 1000);
  });

  // Red ✕ button: ask first (the same dialog as Admin → Close app)
  win.on('close', e => {
    const quit = require('./quit');
    if (quit.quitConfirmed()) return;
    e.preventDefault();
    quit.requestQuit('✕ button');
  });

  setWin(win);
  win.loadFile(path.join(__dirname, '..', 'index.html'));
}

// App icon clicked again while the app is already open: bring the existing window forward
function showWindow() {
  const win = getWin();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

module.exports = { createWindow, showWindow };
