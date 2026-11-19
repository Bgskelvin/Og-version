/* =====================================================================
   former-name.js — the app was called "Leura" before 1.11.0. Data saved
   under that name is moved to the new name once, when the app opens:
   - the data folder  <appData>/leura  →  <appData>/playgroundbooth
     (only when the new folder doesn't exist yet: never merges or overwrites)
   - the default Admin login ID "leura" in a copied config.json → "admin"
   The database file (database.js) and the hidden technical folder in every
   event folder (event-folders.js) follow the new name on their own.
   Safe to run again: once moved, there is nothing left to do.
   ===================================================================== */
const fs = require('fs');
const path = require('path');

const FORMER_NAME = 'leura';
const NAME = 'playgroundbooth';

// Moves <appData>/leura to <appData>/playgroundbooth. Returns notes for the log.
function moveDataFolder(appData) {
  const from = path.join(appData, FORMER_NAME);
  const to = path.join(appData, NAME);
  if (!fs.existsSync(from)) return [];
  if (fs.existsSync(to))
    return [{ level: 'warn', text: `Old data folder ${from} still exists next to ${to}; it was not used` }];
  try {
    fs.renameSync(from, to);
    return [{ level: 'info', text: `Data folder moved from ${from} to ${to} (new app name)` }];
  } catch (e) {
    // e.g. a file is still open by the old app: start with the new folder, try again next time
    return [
      {
        level: 'error',
        text: `Data folder ${from} could not be moved (${e.message}); close the old app and open again`,
      },
    ];
  }
}

// config.json in the data folder (installer) still has the old default login ID
function renameDefaultLogin(dataDir) {
  const file = path.join(dataDir, 'config.json');
  try {
    if (!fs.existsSync(file)) return [];
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!cfg.login || cfg.login.id !== FORMER_NAME) return [];
    cfg.login.id = 'admin';
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    return [{ level: 'info', text: 'Default Admin login ID changed from "leura" to "admin"' }];
  } catch (e) {
    return [{ level: 'warn', text: 'config.json login ID was not updated: ' + e.message }];
  }
}

module.exports = { FORMER_NAME, NAME, moveDataFolder, renameDefaultLogin };
