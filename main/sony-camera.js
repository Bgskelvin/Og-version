/* =====================================================================
   sony-camera.js — USB camera: Sony (A6700, Mac & Windows) or Panasonic Lumix (Windows)
   Runs the camera's helper program as a separate process and translates its
   commands for the app:
     Sony:  kamera-sony/bin/sony-helper (Mac), kamera-sony/bin-win/sony-helper.exe (Windows)
     Lumix: kamera-lumix/bin/lumix-helper.exe (Windows; Lumix Tether SDK)
   Both helpers speak the same protocol, so everything below works for both;
   only the names shown (brandName) and the helper file differ.
   The "sony-sim" mode uses a simulated camera (kamera-sony/simulasi), so
   every flow can be tried without a camera.

   Video flow: the camera records to its SD card → when it stops, the new
   file is copied over USB to the couple folder (in the background, one at a time).

   The helper protocol (commands such as 'sambung', 'rekam-mulai', events such
   as 'terputus', and fields such as tersambung, baterai) is shared with
   kamera-sony/sony-helper.cpp and keeps its Indonesian words; this file
   translates them, so the rest of the app only sees English names.
   ===================================================================== */
const { ipcMain } = require('electron');
const { spawn, execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { userData, readSettings } = require('./storage');
const { getWin } = require('./active-window');

const ROOT = path.join(__dirname, '..');
// Helper program + camera SDK libraries. In the installed app they are in resources/kamera-sony/bin and
// resources/kamera-lumix/bin (copied by the installer, outside app.asar so they can run); with npm start
// in the code folder. The Windows Sony build has its own folder (bin-win) next to the Mac one (bin).
const { app } = require('electron');
const win = () => process.platform === 'win32';
const HELPERS = {
  sony: {
    env: 'SONY_HELPER',
    dir: () => path.join('kamera-sony', app && app.isPackaged ? 'bin' : win() ? 'bin-win' : 'bin'),
    file: () => (win() ? 'sony-helper.exe' : 'sony-helper'),
    build: 'npm run build:sony',
    platforms: ['darwin', 'win32'],
  },
  lumix: {
    env: 'LUMIX_HELPER',
    dir: () => path.join('kamera-lumix', 'bin'),
    file: () => 'lumix-helper.exe',
    build: 'npm run build:lumix',
    platforms: ['win32'],
  },
};
const HELPER = m => {
  const h = HELPERS[m];
  return process.env[h.env] || path.join(app && app.isPackaged ? process.resourcesPath : ROOT, h.dir(), h.file());
};
const SIMULATION_DIR = path.join(ROOT, 'kamera-sony', 'simulasi');
const TEMP_DIR = path.join(userData, 'sony-temp');
const MODES = ['webcam', 'sony', 'sony-sim', 'lumix'];
const HELPER_MODES = ['sony', 'lumix']; // sources with a real helper program
// 'sony' | 'lumix': saved with each session (camera field); brandName() is shown to the operator
const brand = () => (mode === 'lumix' ? 'lumix' : 'sony');
const brandName = () => (mode === 'lumix' ? 'Lumix' : 'Sony');

/* ---------------- Helper program (separate process) ---------------- */
// A helper left over from an earlier app run (e.g. force-quit) can keep holding the camera
// so the camera doesn't answer (error 0x8208). Stop it once per helper when the app starts.
const leftoversCleaned = new Set();
function stopLeftovers(file) {
  if (leftoversCleaned.has(file) || !['darwin', 'win32'].includes(process.platform)) return;
  leftoversCleaned.add(file);
  try {
    if (win()) execFileSync('taskkill', ['/F', '/IM', path.basename(file)], { timeout: 5000, stdio: 'ignore' });
    else execFileSync('pkill', ['-f', file], { timeout: 3000 });
    console.log('Camera: an old helper program left behind was stopped.');
  } catch {
    /* nothing left behind */
  }
}
class Helper extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.seq = 0;
    this.pending = new Map();
    this.proc = null;
  }
  start() {
    stopLeftovers(this.file);
    // detached: Ctrl+C in Terminal doesn't kill this program roughly. If the app stops,
    // its stdin closes and this program disconnects the camera cleanly by itself.
    const p = spawn(this.file, [], { cwd: path.dirname(this.file), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    this.proc = p;
    readline.createInterface({ input: p.stdout }).on('line', line => {
      if (!line.startsWith('{')) return; // ignore other output from the SDK
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.ev) return this.emit('ev', m);
      const t = this.pending.get(m.id);
      if (t) {
        this.pending.delete(m.id);
        clearTimeout(t.timer);
        t.resolve(m);
      }
    });
    this.lastError = '';
    p.stderr.on('data', d => {
      const t = String(d).trim();
      if (t) {
        this.lastError = t.split('\n').pop();
        console.log('[sony-helper] ' + t);
      }
    });
    p.on('error', err => this.finish(`The ${brandName()} camera helper could not start: ` + err.message));
    p.on('exit', code =>
      this.finish(
        `The ${brandName()} camera helper stopped (code ${code})` + (this.lastError ? ': ' + this.lastError : ''),
      ),
    );
    p.stdin.on('error', () => {});
  }
  finish(message) {
    if (!this.proc) return;
    this.proc = null;
    for (const t of this.pending.values()) {
      clearTimeout(t.timer);
      t.resolve({ ok: false, error: message });
    }
    this.pending.clear();
    this.emit('stopped', message);
  }
  send(cmd, args = [], ms = 10000) {
    if (!this.proc) return Promise.resolve({ ok: false, error: `The ${brandName()} camera helper is not running` });
    const id = ++this.seq;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'The camera did not respond (' + cmd + ')' });
      }, ms);
      this.pending.set(id, { resolve, timer });
      this.proc.stdin.write([id, cmd, ...args].join('\t') + '\n');
    });
  }
  // Ask the program to disconnect the camera cleanly; done when the program has really stopped (max 4 seconds)
  stop() {
    const p = this.proc;
    if (!p) return Promise.resolve();
    return new Promise(resolve => {
      const force = setTimeout(() => {
        try {
          p.kill();
        } catch {
          /* the program already stopped by itself */
        }
        resolve();
      }, 4000);
      p.once('exit', () => {
        clearTimeout(force);
        resolve();
      });
      this.send('keluar', [], 3000);
      try {
        p.stdin.end();
      } catch {
        /* the program's input is already closed */
      }
    });
  }
}

/* ---------------- Simulated camera (simulation mode) ---------------- */
class Simulation extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.frame = 0;
    this.recording = false;
    this.no = 1;
    this.downloads = 0;
  }
  start() {
    this.lv = [];
    for (let i = 0; i < 8; i++) {
      try {
        this.lv.push(fs.readFileSync(path.join(SIMULATION_DIR, `lv${i}.jpg`)));
      } catch {
        /* simulation image i doesn't exist: skipped */
      }
    }
    this.running = true;
  }
  stop() {
    this.running = false;
  }
  async send(cmd, args = []) {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    if (!this.running) return { ok: false, error: 'Simulation is off' };
    switch (cmd) {
      case 'sambung':
        await wait(300);
        this.connected = true;
        return { ok: true, model: 'ILCE-6700 (simulasi)' };
      case 'status':
        return {
          ok: true,
          tersambung: !!this.connected,
          model: 'ILCE-6700 (simulasi)',
          baterai: 100,
          kartu: 0,
          sisaDetik: 9000,
          sisaFoto: 2500,
          merekam: this.recording,
          mengunduh: this.downloads > 0,
        };
      case 'lv':
        await wait(30);
        return this.lv.length
          ? { ok: true, buf: this.lv[this.frame++ % this.lv.length] }
          : { ok: false, error: 'No simulation image' };
      case 'foto': {
        await wait(450);
        const f = path.join(args[0], `DSC${String(++this.no).padStart(5, '0')}.JPG`);
        fs.copyFileSync(path.join(SIMULATION_DIR, 'foto.jpg'), f);
        return { ok: true, file: f, ms: 450 };
      }
      case 'rekam-mulai':
        await wait(200);
        this.recording = true;
        return { ok: true };
      case 'mode': {
        const kind = this.modeKind || 'foto';
        if (!args[0] || args[0] === kind)
          return { ok: true, jenis: kind, mode: kind === 'video' ? '0x8050' : '0x1', diubah: false };
        await wait(300);
        this.modeKind = args[0];
        return { ok: true, jenis: args[0], mode: args[0] === 'video' ? '0x8050' : '0x1', diubah: true, coba: 1 };
      }
      case 'rekam-stop': {
        await wait(400);
        this.recording = false;
        const n = ++this.no;
        return {
          ok: true,
          slot: 1,
          contentId: n,
          fileId: 1,
          nama: `C${String(n).padStart(4, '0')}.MP4`,
          ukuran: fs.statSync(path.join(SIMULATION_DIR, 'video.mp4')).size,
        };
      }
      case 'unduh': {
        const job = Date.now();
        this.downloads++;
        setTimeout(() => this.emit('ev', { ev: 'unduh-progres', job, persen: 50 }), 300);
        setTimeout(() => {
          this.downloads--;
          const f = path.join(args[3], `C${String(args[1]).padStart(4, '0')}.MP4`);
          try {
            fs.copyFileSync(path.join(SIMULATION_DIR, 'video.mp4'), f);
            this.emit('ev', { ev: 'unduh-selesai', job, file: f });
          } catch (e) {
            this.emit('ev', { ev: 'unduh-gagal', job, kode: e.message });
          }
        }, 900);
        return { ok: true, job };
      }
      case 'keluar':
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown command: ' + cmd };
    }
  }
}

/* ---------------- Camera manager ---------------- */
let mode = 'webcam',
  hub = null,
  connectTimer = null,
  statusTimer = null,
  connecting = false;
// Status sent to the UI (src/sony-camera.js). The helper program answers with its own (Indonesian)
// field names; they are translated here, in refreshStatus(), handleEvent() and the functions below.
let st = { connected: false, model: '', message: '' };
const pendingDownloads = new Map(); // job -> { resolve }
let downloadQueue = Promise.resolve();

function broadcast() {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('sony-status', status());
}
function status() {
  return { mode, ...st };
}

function scheduleConnect(ms) {
  clearTimeout(connectTimer);
  if (mode === 'webcam' || !hub) return;
  connectTimer = setTimeout(tryConnect, ms);
}
const { explainConnectError } = require('./sony-messages');
// The Lumix helper already explains its errors in words; the SDK code is added for support
const lumixError = r => (r.error || 'The Lumix camera is not connected yet') + (r.kode ? ` (${r.kode})` : '');
const log = require('./log');
let lastFailMessage = ''; // so the same connection failure (retried every 4 s) doesn't flood the log
let successSnapshotTaken = false;
// Snapshot of the computer's state into the log (does it see the camera, programs that might grab it).
// Mac and Windows each have their own tools; elsewhere nothing is logged. Doesn't wait, never fails.
function logMacState(reason) {
  const mac = process.platform === 'darwin';
  if (!mac && !win()) return;
  require(mac ? './mac-diagnostics' : './windows-diagnostics')
    .snapshot()
    .then(b => b.forEach(x => log.write(`  [${mac ? 'Mac' : 'Windows'} state · ${reason}] ${x}`)))
    .catch(() => {});
}
async function tryConnect() {
  if (!hub || st.connected || connecting) return;
  connecting = true;
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const r = await hub.send('sambung', [TEMP_DIR], 30000);
  connecting = false;
  if (!hub) return;
  if (r.ok) {
    Object.assign(st, { connected: true, model: r.model || brandName(), message: '' });
    log.write(`${brandName()} camera connected: ${st.model}`);
    st.modeKind = null;
    hub
      .send('mode', [], 5000)
      .then(m => {
        if (m && m.ok) {
          st.modeKind = fromHelperKind(m.jenis);
          log.write(`Camera mode when connected: ${m.jenis.toUpperCase()} (${m.mode})`);
        }
      })
      .catch(() => {});
    if (!successSnapshotTaken) {
      successSnapshotTaken = true;
      logMacState('connected');
    }
    lastFailMessage = '';
    if (r.catatan) log.warn(`${brandName()} camera: some settings could not be applied: ` + r.catatan);
    await refreshStatus();
  } else {
    Object.assign(st, { connected: false, message: mode === 'lumix' ? lumixError(r) : explainConnectError(r) });
    if (st.message !== lastFailMessage) {
      log.warn(`${brandName()} camera could not connect: ` + st.message + ' (retrying every 4 seconds)');
      lastFailMessage = st.message;
      logMacState('failed ' + (r.kode || ''));
    }
    scheduleConnect(4000);
  }
  broadcast();
}
async function refreshStatus() {
  if (!hub || !st.connected) return;
  const r = await hub.send('status', [], 5000);
  if (r.ok && r.tersambung) {
    Object.assign(st, {
      battery: r.baterai,
      cardError: r.kartu,
      recordSecondsLeft: r.sisaDetik,
      photosLeft: r.sisaFoto,
      recording: r.merekam,
      downloading: r.mengunduh,
    });
    broadcast();
  }
}

function handleEvent(m) {
  if (m.ev === 'terputus') {
    Object.assign(st, {
      connected: false,
      message: `${brandName()} camera disconnected. Check the USB cable and camera power.`,
      modeKind: null,
    });
    log.warn(`${brandName()} camera disconnected` + (m.kode ? ' (' + m.kode + ')' : ''));
    // The SDK tries to reconnect by itself; if that hasn't worked after 8 seconds, the app looks for the camera again
    scheduleConnect(8000);
    for (const t of pendingDownloads.values())
      t.resolve({ ok: false, error: 'The camera disconnected while copying the video' });
    pendingDownloads.clear();
  } else if (m.ev === 'menyambung-ulang') {
    Object.assign(st, { connected: false, message: 'Reconnecting to the camera…' });
  } else if (m.ev === 'tersambung') {
    Object.assign(st, { connected: true, message: '' });
    log.write(`${brandName()} camera connected again`);
    clearTimeout(connectTimer);
  } else if (m.ev === 'unduh-selesai' || m.ev === 'unduh-gagal') {
    const t = pendingDownloads.get(m.job);
    if (m.ev === 'unduh-gagal') log.error('Could not copy the video from the camera card (' + m.kode + ')');
    if (t) {
      pendingDownloads.delete(m.job);
      t.resolve(
        m.ev === 'unduh-selesai'
          ? { ok: true, file: m.file }
          : { ok: false, error: 'Could not copy the video (' + m.kode + ')' },
      );
    }
    return;
  } else return;
  broadcast();
}

// Change the camera source: 'webcam' | 'sony' | 'sony-sim' | 'lumix'
function setSource(m) {
  m = MODES.includes(m) ? m : 'webcam';
  if (m === mode && (hub || m === 'webcam')) return status();
  shutdown();
  modeUnsupported = false; // a new helper program may already support changing modes
  log.write('Camera source: ' + m);
  mode = m;
  st = { connected: false, model: '', message: '' };
  if (m === 'webcam') {
    broadcast();
    return status();
  }
  if (HELPER_MODES.includes(m)) {
    const h = HELPERS[m],
      file = HELPER(m);
    const wrongComputer = !h.platforms.includes(process.platform) && !process.env[h.env];
    if (wrongComputer || !fs.existsSync(file)) {
      st.message = wrongComputer
        ? m === 'lumix'
          ? 'A Lumix camera over USB only works on Windows (the Lumix SDK is Windows only).'
          : 'A Sony camera over USB works on a Mac or Windows.'
        : app && app.isPackaged
          ? `The ${brandName()} camera helper is missing from this ${win() ? 'Leura installation' : 'Leura.app'}. Build the installer again with: ${win() ? 'npm run build:win' : 'npm run build:mac'}`
          : `The ${brandName()} camera helper is not built yet. Run in Terminal: ${h.build}`;
      broadcast();
      return status();
    }
    hub = new Helper(file);
  } else hub = new Simulation();
  const current = hub;
  hub.on('ev', handleEvent);
  hub.on('stopped', message => {
    if (hub !== current) return;
    log.error(message + ' — restarting in 3 seconds');
    Object.assign(st, { connected: false, message });
    broadcast();
    // the helper program stopped suddenly: start it again
    setTimeout(() => {
      if (hub === current && HELPER_MODES.includes(mode)) {
        current.start();
        scheduleConnect(500);
      }
    }, 3000);
  });
  hub.start();
  scheduleConnect(0);
  clearInterval(statusTimer);
  statusTimer = setInterval(refreshStatus, 15000);
  return status();
}
function shutdown() {
  clearTimeout(connectTimer);
  clearInterval(statusTimer);
  let done = Promise.resolve();
  if (hub) {
    const h = hub;
    hub = null;
    if (st.recording) h.send('rekam-stop', [], 3000);
    done = h.stop();
  }
  for (const t of pendingDownloads.values()) t.resolve({ ok: false, error: `${brandName()} camera turned off` });
  pendingDownloads.clear();
  return done;
}

/* ---------------- Functions for other features ---------------- */
const usingSony = () => mode !== 'webcam';
const ready = () => !!hub && st.connected;

async function liveView() {
  if (!ready()) return null;
  const r = await hub.send('lv', [], 3000);
  if (!r.ok) return null;
  return r.buf || Buffer.from(r.jpg, 'base64');
}
/* ---------- Camera mode: photo / video (without turning the dial on the camera) ----------
   Send a message & Quiz → VIDEO mode (16:9 live view = same as the video result).
   Photo booth → PHOTO mode (full resolution, 3:2 live view).
   The camera goes back to the last photo/video mode the operator used (e.g. M).
   With an old helper program (before npm run build:sony) or if the camera refuses,
   the booth keeps working as before. */
let modeQueue = Promise.resolve();
let modeUnsupported = false;
// kind: 'photo' | 'video'. The helper program calls them 'foto' | 'video'.
const toHelperKind = kind => (kind === 'photo' ? 'foto' : kind);
const fromHelperKind = kind => (kind === 'foto' ? 'photo' : kind);
function setMode(kind) {
  if (!['photo', 'video'].includes(kind) || !ready() || modeUnsupported)
    return Promise.resolve({ ok: false, skipped: true });
  if (st.modeKind === kind) return Promise.resolve({ ok: true, kind, changed: false });
  const job = modeQueue.then(async () => {
    if (!ready()) return { ok: false };
    if (st.modeKind === kind) return { ok: true, kind, changed: false };
    const r = await hub.send('mode', [toHelperKind(kind)], 15000);
    if (r.ok) {
      st.modeKind = fromHelperKind(r.jenis);
      if (r.diubah) log.write(`Camera mode: ${r.jenis.toUpperCase()} (${r.mode}, ${r.coba || 1} attempt(s))`);
      broadcast();
    } else if (/Perintah tidak dikenal|Unknown command/.test(r.error || '')) {
      modeUnsupported = true;
      log.warn('Switching photo/video mode is not available yet: run npm run build:sony');
    } else log.warn(`Camera mode could not be changed to ${kind}: ${r.error}`);
    return r.ok ? { ok: true, kind: fromHelperKind(r.jenis), changed: !!r.diubah } : { ok: false, error: r.error };
  });
  modeQueue = job.catch(() => {});
  return job;
}

async function takePhoto() {
  if (!ready()) return { error: st.message || `The ${brandName()} camera is not connected yet` };
  await setMode('photo');
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const r = await hub.send('foto', [TEMP_DIR], 20000);
  if (!r.ok) return { error: r.error };
  try {
    const bytes = fs.readFileSync(r.file);
    fs.unlink(r.file, () => {}); // the original copy stays on the camera's SD card
    return { ok: true, bytes, ms: r.ms };
  } catch (err) {
    return { error: 'The photo arrived but could not be read: ' + err.message };
  }
}
async function startRecording() {
  if (!ready()) return { error: st.message || `The ${brandName()} camera is not connected yet` };
  await setMode('video');
  const r = await hub.send('rekam-mulai', [], 10000);
  if (r.ok) {
    st.recording = true;
    broadcast();
  }
  return r.ok ? { ok: true } : { error: r.error + (r.kode ? ` (${r.kode})` : '') };
}
async function stopRecording() {
  if (!hub) return { error: `The ${brandName()} camera is not active` };
  const r = await hub.send('rekam-stop', [], 45000);
  st.recording = false;
  broadcast();
  // cardFile: the video's file name on the SD card; slot/contentId/fileId: where download() finds it
  return r.ok
    ? { ok: true, cardFile: r.nama, slot: r.slot, contentId: r.contentId, fileId: r.fileId }
    : { error: r.error + (r.kode ? ` (${r.kode})` : '') };
}
// Copy a video from the card to `target` (full .mp4 path). Queued one at a time.
function download(info, target) {
  const job = downloadQueue.then(async () => {
    if (!ready()) return { error: `The ${brandName()} camera is not connected yet` };
    const dir = path.join(TEMP_DIR, 'video-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    const r = await hub.send('unduh', [info.slot, info.contentId, info.fileId, dir], 15000);
    if (!r.ok) return { error: r.error };
    const result = await new Promise(resolve => {
      const limit = setTimeout(() => {
        pendingDownloads.delete(r.job);
        resolve({ ok: false, error: 'Copying the video took too long' });
      }, 20 * 60000);
      pendingDownloads.set(r.job, {
        resolve: v => {
          clearTimeout(limit);
          resolve(v);
        },
      });
    });
    if (!result.ok) return { error: result.error };
    try {
      try {
        fs.renameSync(result.file, target);
      } catch {
        fs.copyFileSync(result.file, target);
        fs.unlinkSync(result.file);
      } // different disk (external SSD)
      fs.rm(dir, { recursive: true, force: true }, () => {});
      return { ok: true, file: target };
    } catch (err) {
      return { error: 'The video was copied but could not be moved to the couple folder: ' + err.message };
    }
  });
  downloadQueue = job.catch(() => {});
  return job;
}

function register() {
  ipcMain.handle('sony-status', () => status());
  ipcMain.handle('sony-live-view', () => liveView());
  ipcMain.handle('sony-photo', () => takePhoto());
  ipcMain.handle('sony-mode', (e, kind) => setMode(kind));
  ipcMain.handle('sony-reconnect', () => {
    if (!hub) {
      const m = mode;
      mode = 'webcam';
      return setSource(m);
    } // e.g. the helper program was just built
    st.connected = false;
    connecting = false;
    scheduleConnect(0);
    return status();
  });
}
// When the app opens: clean up leftover temporary files, then use the camera source from the settings
function start() {
  try {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch {
    /* the temporary folder doesn't exist yet */
  }
  setSource(readSettings().camera);
}

module.exports = {
  register,
  start,
  setSource,
  shutdown,
  status,
  usingSony,
  brand,
  brandName,
  ready,
  takePhoto,
  startRecording,
  stopRecording,
  download,
  MODES,
};
