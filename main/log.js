/* =====================================================================
   log.js — the app's daily log, for tracking down problems after an
   event. One text file per day in the app data folder:
       <data folder>/catatan/2026-11-06.txt
   Contents: app opened/closed, camera connected/disconnected (+ error code),
   recordings & photos saved/failed, QR uploads, UI crashes, and every
   console.log/console.error from the main process & the UI.
   - Logs older than 30 days are deleted automatically.
   - If writing the log fails, the app keeps running (guests are not affected).
   - Never log passwords or the booth key.
   In Admin → App: "View log" and "Save log".
   ===================================================================== */
const { app, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(app.getPath('userData'), 'catatan');
const KEEP_DAYS = 30;
const MAX_LINE = 2000; // a log line is cut if it is longer than this
const MARK = { info: ' ', warn: '⚠', error: '✗' };
const LEVELS = ['info', 'warn', 'error'];

const pad = n => String(n).padStart(2, '0');
const dateStamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStamp = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dayFile = (t = dateStamp()) => path.join(LOG_DIR, t + '.txt');
const appVersion = () => {
  try {
    return app.getVersion();
  } catch {
    return '?';
  }
};

let dirReady = false;
// Write one line. level: 'info' | 'warn' | 'error'
function write(message, level = 'info') {
  try {
    if (!dirReady) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      dirReady = true;
    }
    const text = String(message)
      .replace(/\s*\n\s*/g, ' ⏎ ')
      .slice(0, MAX_LINE);
    fs.appendFileSync(dayFile(), `${timeStamp()} ${MARK[level] || ' '} ${text}\n`);
  } catch {
    /* the log could not be written: don't disturb the app */
  }
}
const warn = p => write(p, 'warn');
const error = p => write(p, 'error');

// Every console.log / warn / error in the main process also goes into the log
let consoleHooked = false;
function hookConsole() {
  if (consoleHooked) return;
  consoleHooked = true;
  const original = { log: console.log, warn: console.warn, error: console.error };
  const join = a =>
    a
      .map(x =>
        x instanceof Error
          ? x.stack || x.message
          : typeof x === 'string'
            ? x
            : (() => {
                try {
                  return JSON.stringify(x);
                } catch {
                  return String(x);
                }
              })(),
      )
      .join(' ');
  console.log = (...a) => {
    original.log(...a);
    write(join(a));
  };
  console.warn = (...a) => {
    original.warn(...a);
    write(join(a), 'warn');
  };
  console.error = (...a) => {
    original.error(...a);
    write(join(a), 'error');
  };
  process.on('uncaughtException', e => {
    original.error(e);
    write('Unhandled error: ' + ((e && e.stack) || e), 'error');
  });
  process.on('unhandledRejection', e => {
    original.error(e);
    write('Unhandled promise rejection: ' + ((e && e.stack) || e), 'error');
  });
}

// Delete logs older than KEEP_DAYS days
function deleteOld() {
  try {
    const limit = Date.now() - KEEP_DAYS * 86400000;
    for (const f of fs.readdirSync(LOG_DIR)) {
      const m = /^(\d{4})-(\d\d)-(\d\d)\.txt$/.exec(f);
      if (m && new Date(+m[1], +m[2] - 1, +m[3]).getTime() < limit) fs.unlinkSync(path.join(LOG_DIR, f));
    }
  } catch {
    /* old logs are tried again the next time the app opens */
  }
}
// List of log files, newest first
function listFiles() {
  try {
    return fs
      .readdirSync(LOG_DIR)
      .filter(f => /^\d{4}-\d\d-\d\d\.txt$/.test(f))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function register() {
  // Lines from the UI (JavaScript errors, small crashes on the guest screen).
  // 'peringatan' is the old name of 'warn' and is still accepted.
  ipcMain.on('catat', (e, message, level) => {
    const lv = level === 'peringatan' ? 'warn' : level;
    write('[ui] ' + String(message).slice(0, MAX_LINE), LEVELS.includes(lv) ? lv : 'info');
  });
  // Admin → "View log": the most recent day's log (at most the last ±400 lines)
  ipcMain.handle('catatan-baca', () => {
    const files = listFiles();
    if (!files.length) return { teks: '', file: '', hari: [] };
    let text = '';
    try {
      text = fs.readFileSync(path.join(LOG_DIR, files[0]), 'utf8');
    } catch {
      /* today's log file doesn't exist yet */
    }
    const lines = text.split('\n');
    if (lines.length > 401) text = '… (earlier lines not shown)\n' + lines.slice(-401).join('\n');
    return { teks: text, file: files[0].replace('.txt', ''), hari: files.map(f => f.replace('.txt', '')) };
  });
  // Admin → "Save log": the last 7 days combined in one file, to send to someone
  ipcMain.handle('catatan-simpan', async () => {
    const files = listFiles().slice(0, 7).reverse();
    if (!files.length) return { error: 'No log entries yet.' };
    const r = await dialog.showSaveDialog({
      title: 'Save app log',
      defaultPath: path.join(app.getPath('downloads'), `Leura-log-${dateStamp()}.txt`),
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (r.canceled || !r.filePath) return { batal: true };
    try {
      const content = [
        `Leura app log — saved ${dateStamp()} ${timeStamp()}`,
        `Version ${appVersion()} · ${process.platform} ${require('os').release()}`,
        '',
      ];
      for (const f of files)
        content.push(`===== ${f.replace('.txt', '')} =====`, fs.readFileSync(path.join(LOG_DIR, f), 'utf8'));
      fs.writeFileSync(r.filePath, content.join('\n'));
      shell.showItemInFolder(r.filePath);
      write('Log saved to ' + r.filePath);
      return { ok: true, file: r.filePath };
    } catch (e) {
      return { error: 'Could not save: ' + e.message };
    }
  });
}

function start() {
  deleteOld();
  write('────────── App opened ──────────');
  write(
    `Leura version ${appVersion()} · ${process.platform} ${require('os').release()} · Electron ${process.versions.electron}`,
  );
}

module.exports = { write, warn, error, hookConsole, register, start, LOG_DIR, dayFile, dateStamp };
