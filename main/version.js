/* =====================================================================
   version.js — the Leura version shown in the log and in Admin → About.
   Installed app: Electron knows it (from package.json inside the app).
   From the code folder ("npm start" = electron main.js): Electron would give
   its OWN version there (e.g. 45.2.1), so package.json is read directly.
   ===================================================================== */
const { app } = require('electron');

function appVersion() {
  try {
    if (!app.isPackaged) return require('../package.json').version;
    return app.getVersion();
  } catch {
    return '?'; // never let a missing version stop the app
  }
}

module.exports = { appVersion };
