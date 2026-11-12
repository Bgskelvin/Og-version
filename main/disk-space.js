/* =====================================================================
   disk-space.js — free space on the disk of the chosen storage folder
   (Admin → Storage). That folder can be on an external SSD, so the space
   shown is always for that disk, not for the Mac's own disk.
   - Admin shows "x GB free of y GB" under the storage folder.
   - The screen asks every minute; when space runs low the operator sees
     a notice, and the change is written to the log.
   - Below MIN_TO_START a new recording or photo session is refused with a
     clear message, so a guest never records something that can't be saved.
   ===================================================================== */
const { ipcMain } = require('electron');
const fs = require('fs');
const { defaultDir, getOutDir, usableDir } = require('./storage');
const log = require('./log');

const GB = 1024 ** 3;
const LOW = 20 * GB; // warning: roughly an hour of Sony video left
const CRITICAL = 5 * GB; // urgent warning
const MIN_TO_START = 1 * GB; // below this, new recordings/photos are refused

const levelFor = free => (free < MIN_TO_START ? 'full' : free < CRITICAL ? 'critical' : free < LOW ? 'low' : 'ok');
const formatGB = bytes => (bytes >= 10 * GB ? Math.round(bytes / GB) : Math.round((bytes / GB) * 10) / 10) + ' GB';

// The folder new files go to: the chosen folder, or the default folder if the chosen one is not available
function targetDir() {
  const chosen = getOutDir();
  if (usableDir(chosen)) return { dir: chosen, fallback: false };
  return { dir: defaultDir, fallback: chosen !== defaultDir };
}

let lastLevel = 'ok';
function check() {
  const { dir, fallback } = targetDir();
  try {
    const s = fs.statfsSync(dir);
    const free = s.bavail * s.bsize,
      total = s.blocks * s.bsize;
    const level = levelFor(free);
    if (level !== lastLevel) {
      const text = `Free space in the storage folder: ${formatGB(free)} of ${formatGB(total)} (${dir})`;
      if (level === 'ok') log.write(text);
      else log.warn(text + ' — ' + level);
      lastLevel = level;
    }
    return { ok: true, dir, fallback, free, total, level };
  } catch (e) {
    log.warn('Free space could not be read for ' + dir + ': ' + e.message);
    return { ok: false, dir, fallback, error: e.message };
  }
}

// For rec-start / save-photos: an error text when there is no room, otherwise null
function refuseIfFull() {
  const r = check();
  if (!r.ok || r.level !== 'full') return null;
  return `Storage is full (${formatGB(r.free)} left). Free up space or choose another folder in Admin.`;
}

function register() {
  ipcMain.handle('disk-space', () => check());
}

module.exports = { register, check, refuseIfFull, levelFor, formatGB, GB };
