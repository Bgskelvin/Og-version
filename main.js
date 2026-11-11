/* =====================================================================
   main.js — starting point of the app (Electron main process)
   It only holds the start-up order. The features live in main/:
     storage.js          data locations, config.json, safe JSON read/write
     settings.js         Admin settings, login, storage folder
     couple.js           couple data & the active couple
     recording.js        video recording, MP4, recovering interrupted recordings
     video-processing.js quiz texts on the video & phone version for QR (FFmpeg)
     photo.js            saving Photo Booth results
     template.js         photo design templates per couple
     filter.js           photo filters (.cube LUT) for templates
     sony-camera.js      Sony camera over USB (helper program + simulation)
     upload.js           download by QR: upload queue to Cloudflare
     window.js           window, menu, navigation guards
     log.js              daily log for tracking down problems
     quit.js             closing the app with confirmation (Admin, ✕ button, ⌘Q)
     about.js            app version & third-party licenses (Admin → App)
   ===================================================================== */
const { app, session, systemPreferences, powerSaveBlocker } = require('electron');
const path = require('path');

// ---------- The data folder is always the same ----------
// ~/Library/Application Support/leura — shared by "npm start" (code folder)
// and Leura.app (installer), so couples, recordings, settings & the QR queue don't move.
// Must be set first: the "single window" lock & every module use this folder.
if (app.setPath) app.setPath('userData', path.join(app.getPath('appData'), 'leura'));

// ---------- Only one app window ----------
// If the icon is clicked again while the app is running, the existing window is shown,
// instead of opening a second app that fights over the camera and data files.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
const DEV = process.argv.includes('--dev'); // npx electron main.js --dev  -> Reload & DevTools menu on

// The daily log is set up first, so every message & error after it is recorded too
const log = require('./main/log');
log.hookConsole();
log.register();

const recording = require('./main/recording');
const appWindow = require('./main/window');
require('./main/settings').register();
require('./main/couple').register();
require('./main/photo').register();
require('./main/template').register();
require('./main/filter').register();
const sonyCamera = require('./main/sony-camera');
sonyCamera.register();
const upload = require('./main/upload');
upload.register();
require('./main/quit').register();
require('./main/about').register();
recording.register();

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('camera');
    await systemPreferences.askForMediaAccess('microphone');
  }
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media'));
  powerSaveBlocker.start('prevent-display-sleep'); // the screen & computer don't sleep while the app runs

  log.start(); // "App opened" + delete old logs
  recording.start(); // recover interrupted recordings & continue conversions
  appWindow.createWindow(DEV);
  sonyCamera.start(); // connect the Sony camera if chosen in Admin
  upload.start(); // continue the remaining photo upload queue (QR)
});

app.on('second-instance', () => appWindow.showWindow());
app.on('window-all-closed', () => app.quit());
// When quitting: wait for the Sony camera to disconnect cleanly first (max ±4 seconds), then really close
let cleanedUp = false;
const quit = require('./main/quit');
app.on('before-quit', e => {
  if (cleanedUp) return;
  e.preventDefault();
  if (!quit.quitConfirmed()) return quit.requestQuit('⌘Q'); // ask first, like the Close app button in Admin
  log.write('App closed');
  recording.closeAll();
  Promise.resolve(sonyCamera.shutdown())
    .catch(() => {})
    .then(() => {
      cleanedUp = true;
      app.quit();
    });
});
