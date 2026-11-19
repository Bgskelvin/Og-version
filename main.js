/* =====================================================================
   main.js — starting point of the app (Electron main process)
   It only holds the start-up order. The features live in main/:
     storage.js          data locations, config.json, safe JSON read/write
     database.js         the database (settings, couples, session history, QR queue)
     migrate.js          brings data from older versions up to date
     settings.js         Admin settings, login, storage folder
     couple.js           couple data & the active couple
     recording.js        video recording, MP4, recovering interrupted recordings
     video-processing.js quiz texts on the video & phone version for QR (FFmpeg)
     photo.js            saving Photo Booth results
     print.js            printing guest photos (print queue, printer / PDF test)
     event-folders.js    one folder per wedding, subfolders per kind, guest numbers
     album.js            Album.html: the offline gallery in every event folder
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
// ~/Library/Application Support/playgroundbooth (Windows: %APPDATA%playgroundbooth) — shared by "npm start" (code folder)
// and PlaygroundBooth.app (installer), so couples, recordings, settings & the QR queue don't move.
// Must be set first: the "single window" lock & every module use this folder.
// From the code folder only (not PlaygroundBooth.app): --data-dir=<folder> uses another data folder,
// e.g. to try a new version on a copy of the event data without touching the real data.
// Data saved under the former name (Leura, before 1.11.0) is moved to the new folder once (former-name.js).
const formerName = require('./main/former-name');
const dataDirArg = !app.isPackaged && process.argv.find(a => a.startsWith('--data-dir='));
const renameNotes = [];
if (app.setPath) {
  if (!dataDirArg) renameNotes.push(...formerName.moveDataFolder(app.getPath('appData')));
  app.setPath(
    'userData',
    dataDirArg ? path.resolve(dataDirArg.slice(11)) : path.join(app.getPath('appData'), formerName.NAME),
  );
  renameNotes.push(...formerName.renameDefaultLogin(app.getPath('userData')));
}

// ---------- Only one app window ----------
// If the icon is clicked again while the app is running, the existing window is shown,
// instead of opening a second app that fights over the camera and data files.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
const DEV = process.argv.includes('--dev'); // npx electron main.js --dev  -> Reload & DevTools menu on

// Data saved by older versions (Indonesian field & folder names) is brought up to date
// before any module reads it. Its notes go into the log once the log is ready.
let migrationNotes;
try {
  migrationNotes = [...renameNotes, ...require('./main/migrate').run(), ...require('./main/database').takeNotes()];
} catch (e) {
  // The database was made by a newer PlaygroundBooth: don't touch it, tell the operator what to do
  require('electron').dialog.showErrorBox(
    'PlaygroundBooth',
    /newer PlaygroundBooth/.test(e.message)
      ? 'This data was saved by a newer version of PlaygroundBooth. Please install the newest PlaygroundBooth to open it.'
      : 'PlaygroundBooth could not open its data: ' + e.message,
  );
  app.exit(1);
  process.exit(1);
}

// Recordings & photos of older versions → one folder per wedding (before any module reads their paths).
// Never stops the app: a problem is logged and tried again next time.
try {
  migrationNotes.push(...require('./main/event-folders').reorganize());
  migrationNotes.push(...require('./main/event-folders').renameFormerSystemDirs());
} catch (e) {
  migrationNotes.push({ level: 'error', text: 'Event folders could not be arranged: ' + e.message });
}

// The daily log is set up first, so every message & error after it is recorded too
const log = require('./main/log');
log.hookConsole();
log.register();

const recording = require('./main/recording');
const appWindow = require('./main/window');
require('./main/settings').register();
require('./main/disk-space').register();
require('./main/couple').register();
require('./main/photo').register();
const print = require('./main/print');
print.register();
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
  migrationNotes.forEach(n => log.write(n.text, n.level));
  dailyDatabaseBackup();
  setInterval(dailyDatabaseBackup, 60 * 60 * 1000).unref(); // the app can stay open for days
  recording.start(); // recover interrupted recordings & continue conversions
  appWindow.createWindow(DEV);
  sonyCamera.start(); // connect the Sony camera if chosen in Admin
  upload.start(); // continue the remaining photo upload queue (QR)
  print.start(); // continue prints that were waiting when the app closed
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

// A copy of the database once a day (backup/database/, last 7 days kept)
function dailyDatabaseBackup() {
  try {
    const file = require('./main/storage').db.dailyBackup();
    if (file) log.write('Database copy saved: ' + path.basename(file));
  } catch (e) {
    log.warn('Database copy could not be saved: ' + e.message);
  }
}
