/* =====================================================================
   quit.js — closing the app with confirmation.
   The "Close app" button in Admin, the window's red ✕ button and ⌘Q
   all show the same dialog ("Close the app?" + a warning about videos/QR
   photos still in progress). Only after "Close app" is chosen is the app
   closed the official way (app.quit), so main.js closes the recordings
   and disconnects the Sony camera cleanly.
   Mac shutting down / restarting: closed right away without asking.
   ===================================================================== */
const { ipcMain, app } = require('electron');
const { readSessions } = require('./storage');
const { getWin } = require('./active-window');
const upload = require('./upload');

let confirmed = false;
const quitConfirmed = () => confirmed;

// Work still in progress, for the warning before closing
function pendingWork() {
  let copying = 0,
    processing = 0;
  try {
    for (const s of readSessions()) {
      if (s.status === 'transfer') copying++;
      else if (s.status === 'processing') processing++;
    }
  } catch {
    /* session history unreadable: assume no video is being processed */
  }
  let photos = 0;
  try {
    photos = upload.status().waiting || 0;
  } catch {
    /* QR queue not loaded yet: assume empty */
  }
  // Field names are shared with the UI (src/admin.js)
  return { copying, processing, photos };
}

// ✕ or ⌘Q pressed: ask the UI to show the confirmation dialog.
// If there is no UI / it crashed, just close (the app must never become impossible to close).
function requestQuit(source) {
  const win = getWin();
  const wc = win && !win.isDestroyed() ? win.webContents : null;
  if (!wc || (wc.isCrashed && wc.isCrashed())) {
    confirmed = true;
    app.quit();
    return;
  }
  require('./log').write(`Close app requested (${source}) — waiting for confirmation`);
  wc.send('quit-request');
}

function register() {
  ipcMain.handle('check-quit', () => pendingWork());
  ipcMain.handle('quit-app', () => {
    require('./log').write('Close app confirmed');
    confirmed = true;
    setTimeout(() => app.quit(), 300);
    return { ok: true };
  });
  // Mac shutting down / restarting / logging out: don't block it
  app.whenReady().then(() => {
    try {
      require('electron').powerMonitor.on('shutdown', () => {
        confirmed = true;
      });
    } catch {
      /* powerMonitor not ready yet (before app ready) */
    }
  });
}

module.exports = { register, pendingWork, quitConfirmed, requestQuit };
