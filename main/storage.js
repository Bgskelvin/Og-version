/* =====================================================================
   storage.js — data locations, config.json, the database (settings,
   session history; see database.js), safe JSON read/write for the files
   that stay files (templates, filters), and file/folder name helpers.
   Used by every other module in main/.
   ===================================================================== */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

/* ---------- Configuration ---------- */
const bundledCfg = path.join(__dirname, '..', 'config.json');
const configPath = app.isPackaged ? path.join(app.getPath('userData'), 'config.json') : bundledCfg;
if (app.isPackaged && !fs.existsSync(configPath)) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.copyFileSync(bundledCfg, configPath);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

/* ---------- Data locations ---------- */
const userData = app.getPath('userData');
const defaultDir = path.join(app.getPath('documents'), 'VideoboothRecordings');
fs.mkdirSync(userData, { recursive: true });
const db = require('./database').openDatabase(userData);

function tryRead(p) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch (e) {
    return { ok: false, missing: e.code === 'ENOENT' };
  }
}
// Read a file; if it is damaged, use the backup (.bak). A damaged file is never silently thrown away.
function readJSON(p, fallback) {
  const a = tryRead(p);
  if (a.ok) return a.data;
  const b = tryRead(p + '.bak');
  if (b.ok) {
    if (!a.missing) console.log('File damaged, using the backup: ' + p);
    return b.data;
  }
  if (!a.missing) {
    console.log('File damaged and no backup, a copy was kept: ' + p);
    try {
      fs.copyFileSync(p, p + '.corrupt-' + Date.now());
    } catch {
      /* the copy of the damaged file is only for inspection; the fallback data is used anyway */
    }
  }
  return fallback;
}
// Safe write: write to a temporary file, keep the old version as .bak, then swap in one step.
// If the power goes out halfway, the old file or its backup is still intact.
function writeJSON(p, data) {
  const tmp = p + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (tryRead(p).ok) {
    try {
      fs.copyFileSync(p, p + '.bak');
    } catch {
      /* .bak backup failed: the main file is still written */
    }
  }
  try {
    fs.renameSync(tmp, p);
  } catch {
    fs.copyFileSync(tmp, p);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* temporary file left behind, overwritten on the next write */
    }
  } // fallback if rename is blocked (e.g. antivirus)
}
const readSettings = () => db.readSettings();
const writeSettings = s => db.writeSettings(s);
const readSessions = () => db.readSessions();
const writeSessions = l => db.writeSessions(l);

const getOutDir = () => readSettings().outDir || defaultDir;

// Couple name -> a name that is safe for folders & files on Windows and Mac
function safeName(name) {
  const s = String(name || '')
    // eslint-disable-next-line no-control-regex -- on purpose: control characters are not allowed in file names
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // forbidden characters
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '') // Windows: may not end with a dot/space
    .slice(0, 60);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) ? s + '_' : s;
}
function coupleDir(base, name) {
  const n = safeName(name);
  return n ? path.join(base, n) : base;
}
function usableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
const updateSession = (id, patch) => db.updateSession(id, patch);

// Guest name from the "What's your name?" screen -> a safe file name (max 40 characters)
const guestFileName = t => safeName(String(t || '').slice(0, 40));
// A base file name not yet used in that folder: "Budi", then "Budi_2", "Budi_3", ...
// `isTaken(name)` returns true if that base name is already in use.
function freeBaseName(base, isTaken) {
  if (!isTaken(base)) return base;
  for (let n = 2; n < 10000; n++) if (!isTaken(`${base}_${n}`)) return `${base}_${n}`;
  return `${base}_${Date.now()}`;
}

const pad = n => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

module.exports = {
  config,
  configPath,
  userData,
  defaultDir,
  db,
  readJSON,
  writeJSON,
  readSettings,
  writeSettings,
  readSessions,
  writeSessions,
  updateSession,
  getSession: id => db.getSession(id),
  saveSession: s => db.saveSession(s),
  deleteSession: id => db.deleteSession(id),
  getOutDir,
  usableDir,
  safeName,
  coupleDir,
  stamp,
  guestFileName,
  freeBaseName,
};
