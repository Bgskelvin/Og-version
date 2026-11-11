/* =====================================================================
   mac-diagnostics.js — snapshot of the Mac's state when the Sony camera
   connects / fails. Written to the daily log, so "connected" and "failed"
   states can be compared (e.g. macOS programs that grab the camera:
   ptpcamerad, mscamerad-xpc, icdd; or a camera card that shows up as a disk).
   Every step has a time limit and never makes the app fail.
   ===================================================================== */
const { execFile } = require('child_process');
const fs = require('fs');

const PROCESS_PATTERN =
  /ptpcamera|mscamera|icdd|sony-helper|Image Capture|Photos\.app|Imaging Edge|Remote Camera|cameracaptured/i;

const run = (cmd, args, ms) =>
  new Promise(res => {
    execFile(cmd, args, { timeout: ms, maxBuffer: 8 * 1024 * 1024 }, (err, out) => res(err ? '' : String(out || '')));
  });

// Camera-related programs: "name (started at time)"
async function cameraProcesses() {
  const out = await run('ps', ['-axo', 'pid=,lstart=,comm='], 4000);
  return out
    .split('\n')
    .filter(l => PROCESS_PATTERN.test(l))
    .map(l => {
      // "  512 Fri  6 Nov 16:05:13 2026 /usr/libexec/ptpcamerad" (day/month order follows the Mac's language)
      const m = /^\s*(\d+)\s+(.*?(\d{1,2}:\d\d:\d\d)).*?\d{4}\s+(.*)$/.exec(l);
      return m ? `${m[4].split('/').pop()} (pid ${m[1]}, started ${m[3]})` : l.trim().split('/').pop();
    });
}
// The Sony camera in the macOS USB list (name, speed; serial number left out)
async function sonyUsb() {
  if (process.platform !== 'darwin') return [];
  // newer macOS uses SPUSBHostDataType; older macOS SPUSBDataType
  const out = await run('system_profiler', ['SPUSBHostDataType', 'SPUSBDataType', '-detailLevel', 'mini'], 10000);
  const lines = out.split('\n'),
    found = [];
  lines.forEach((l, i) => {
    if (!/sony|ilce|054c/i.test(l)) return;
    const block = lines
      .slice(i, i + 10)
      .map(x => x.trim())
      .filter(x => /:|^ILCE|Sony/i.test(x) && !/Serial Number/i.test(x));
    found.push(block.slice(0, 6).join(' · '));
  });
  return [...new Set(found)].slice(0, 2);
}
// Mounted disks (a camera card used as USB storage shows up here)
function mountedDisks() {
  try {
    return fs.readdirSync('/Volumes').filter(v => !/^Macintosh HD|^com\.apple|^\./.test(v));
  } catch {
    return [];
  }
}

async function snapshot() {
  const [processes, usb] = await Promise.all([cameraProcesses().catch(() => []), sonyUsb().catch(() => [])]);
  const disks = mountedDisks();
  return [
    `camera processes: ${processes.length ? processes.join('; ') : '(none)'}`,
    `USB: ${usb.length ? usb.join(' | ') : process.platform === 'darwin' ? '(Sony camera not visible on USB)' : '(not a Mac)'}`,
    `external disks: ${disks.length ? disks.join(', ') : '(none)'}`,
  ];
}

module.exports = { snapshot, cameraProcesses, mountedDisks };
