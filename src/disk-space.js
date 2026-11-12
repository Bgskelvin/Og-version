/* =====================================================================
   disk-space.js — free space on the disk of the chosen storage folder.
   - Admin → Storage shows "x GB free of y GB" for that folder's disk.
   - Checked every minute; when space runs low the operator gets a notice
     (again every 10 minutes while it stays low).
   - When the disk is full, Start doesn't open a new guest session.
   The limits are set in main/disk-space.js.
   ===================================================================== */
import { $, state } from './state.js';
import { setNotice } from './app.js';

const CHECK_MS = 60 * 1000;
const REPEAT_NOTICE_MS = 10 * 60 * 1000;
const GB = 1024 ** 3;
const formatGB = bytes => (bytes >= 10 * GB ? Math.round(bytes / GB) : Math.round((bytes / GB) * 10) / 10) + ' GB';

const NOTICES = {
  low: free => `Storage is getting full: ${free} left. Free up space or choose another folder in Admin.`,
  critical: free => `Storage almost full: only ${free} left! Free up space or choose another folder in Admin now.`,
  full: free =>
    `Storage is full (${free} left). New sessions can't start. Free up space or choose another folder in Admin.`,
};

let lastNotice = { level: 'ok', at: 0 };

export async function refreshDiskSpace() {
  try {
    state.disk = await api.diskSpace();
  } catch (e) {
    console.warn('Free space could not be read: ' + e.message);
    state.disk = null;
  }
  showInAdmin();
  warnOperator();
  return state.disk;
}

export const diskIsFull = () => !!(state.disk && state.disk.ok && state.disk.level === 'full');
export const diskFullNotice = () => NOTICES.full(formatGB(state.disk.free));

function showInAdmin() {
  const el = $('diskFree');
  if (!el) return;
  const d = state.disk;
  if (!d || !d.ok) {
    el.textContent = d && d.unsupported ? '' : 'Free space: unknown';
    el.className = 'disk-free';
    return;
  }
  el.textContent =
    `Free space: ${formatGB(d.free)} of ${formatGB(d.total)}` +
    ({ low: ' — running low', critical: ' — almost full', full: ' — full' }[d.level] || '');
  el.className = 'disk-free ' + d.level;
}

function warnOperator() {
  const d = state.disk;
  const level = d && d.ok ? d.level : 'ok';
  const now = Date.now();
  if (level === 'ok') {
    lastNotice = { level, at: now };
    return;
  }
  // Don't cover a guest who is recording or taking photos; the next check shows it
  if (state.busy) return;
  if (level === lastNotice.level && now - lastNotice.at < REPEAT_NOTICE_MS) return;
  lastNotice = { level, at: now };
  setNotice(NOTICES[level](formatGB(d.free)), 15000);
}

// Wire up this feature (called once from start.js)
export function setupDiskSpace() {
  refreshDiskSpace();
  setInterval(refreshDiskSpace, CHECK_MS);
}
