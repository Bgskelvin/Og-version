/* =====================================================================
   windows-diagnostics.js — snapshot of the Windows computer's state when a
   USB camera (Sony / Lumix) connects or fails. Written to the daily log, so
   "connected" and "failed" can be compared afterwards: does Windows see the
   camera at all, and is another program holding it (LUMIX Tether, Imaging
   Edge, Photos, …)? The Windows twin of mac-diagnostics.js.
   Every step has a time limit and never makes the app fail.
   ===================================================================== */
const { execFile } = require('child_process');

// Programs that open a camera over USB and keep other programs out
const PROCESS_PATTERN =
  /^(LUMIX ?Tether|LumixTether|LUMIX ?Sync|Imaging ?Edge|Remote\.exe|Viewer\.exe|ImagingEdge|sony-helper|lumix-helper|Microsoft\.Photos|PhotosApp|WindowsCamera|obs64|digiCamControl|CameraControl)/i;

const run = (cmd, args, ms) =>
  new Promise(res => {
    execFile(cmd, args, { timeout: ms, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) =>
      res(err ? '' : String(out || '')),
    );
  });

// Cameras and portable devices Windows sees: "DC-S5M2X (WPD, OK)". Serial numbers are left out.
async function cameraDevices() {
  const script =
    "Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.Class -in 'WPD','Image','Camera' -or $_.InstanceId -match 'VID_054C|VID_04DA' } | ForEach-Object { $_.FriendlyName + ' (' + $_.Class + ', ' + $_.Status + ')' }";
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 12000);
  return [
    ...new Set(
      out
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean),
    ),
  ].slice(0, 8);
}
// Camera-related programs that are running
async function cameraProcesses() {
  const out = await run('tasklist.exe', ['/FO', 'CSV', '/NH'], 6000);
  const names = out
    .split(/\r?\n/)
    .map(l => (/^"([^"]+)"/.exec(l) || [])[1])
    .filter(n => n && PROCESS_PATTERN.test(n));
  return [...new Set(names)];
}

async function snapshot() {
  const [devices, processes] = await Promise.all([cameraDevices().catch(() => []), cameraProcesses().catch(() => [])]);
  return [
    `cameras Windows sees: ${devices.length ? devices.join('; ') : '(none)'}`,
    `camera programs running: ${processes.length ? processes.join(', ') : '(none)'}`,
  ];
}

module.exports = { snapshot, cameraDevices, cameraProcesses, PROCESS_PATTERN };
