/* =====================================================================
   bantu.js — alat bantu uji: Electron palsu, folder sementara, pemeriksa
   Proses utama (main.js) dijalankan dengan Electron tiruan, jadi uji bisa
   berjalan dengan Node biasa tanpa membuka jendela.
   ===================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// ---------- Pemeriksa sederhana ----------
let gagal = 0, lulus = 0;
function cek(kondisi, keterangan, detail) {
  if (kondisi) { lulus++; console.log('  ✓ ' + keterangan); }
  else { gagal++; console.log('  ✗ ' + keterangan + (detail !== undefined ? '  →  ' + JSON.stringify(detail) : '')); }
}
const hasil = () => ({ lulus, gagal });
const tunggu = ms => new Promise(r => setTimeout(r, ms));

// ---------- Electron palsu ----------
function pasangElectronPalsu({ dataDir, docsDir, platform, lock = true, argv = [] }) {
  const handlers = {}, listeners = {}, appEvents = {}, wcEvents = {};
  let readyResolve;
  const wc = {
    on: (n, f) => { wcEvents[n] = f; }, send: (...a) => { wc.terkirim.push(a); }, terkirim: [],
    setWindowOpenHandler: f => { wc.openHandler = f; }, setVisualZoomLevelLimits() {}, setZoomFactor() {},
    reload() { wc.dimuatUlang = true; }
  };
  const electron = {
    app: {
      isPackaged: false,
      getPath: k => (k === 'userData' ? dataDir : docsDir),
      whenReady: () => new Promise(r => { readyResolve = r; }),
      on: (n, f) => { appEvents[n] = f; },
      requestSingleInstanceLock: () => lock,
      quit() { electron.__keluar = true; }
    },
    BrowserWindow: class {
      constructor(o) { this.opsi = o; this.webContents = wc; electron.__jendela = this; }
      isDestroyed() { return false; } loadFile(f) { this.dimuat = f; } isMinimized() { return false; }
      show() {} focus() { this.difokuskan = true; } restore() {} setKiosk(v) { this.kiosk = v; } setFullScreen() {}
    },
    ipcMain: { handle: (n, f) => { handlers[n] = f; }, on: (n, f) => { listeners[n] = f; } },
    session: { defaultSession: { setPermissionRequestHandler() {} } },
    systemPreferences: { askForMediaAccess: async () => true },
    shell: { openPath: async p => { electron.__dibuka = p; return ''; } },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    powerSaveBlocker: { start() {} },
    Menu: { buildFromTemplate: t => t, setApplicationMenu: m => { electron.__menu = m; } },
    __handlers: handlers, __listeners: listeners, __appEvents: appEvents, __wcEvents: wcEvents, __wc: wc,
    __siap: () => readyResolve()
  };
  const asli = Module._load;
  Module._load = function (req) {
    if (req === 'electron') return electron;
    if (req === 'ffmpeg-static') return null;      // uji tidak menjalankan FFmpeg sungguhan
    return asli.apply(this, arguments);
  };
  if (platform) Object.defineProperty(process, 'platform', { value: platform });
  process.argv.push(...argv);
  return electron;
}

// Menyalakan main.js dengan folder data sementara
function nyalakanAplikasi(opsi = {}) {
  const akar = opsi.akar || fs.mkdtempSync(path.join(os.tmpdir(), 'videobooth-uji-'));
  const dataDir = path.join(akar, 'data'), docsDir = path.join(akar, 'docs');
  fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(docsDir, { recursive: true });
  const electron = pasangElectronPalsu({ dataDir, docsDir, ...opsi });
  require(path.join(__dirname, '..', 'main.js'));
  const panggil = (nama, ...args) => electron.__handlers[nama]({}, ...args);
  const kirim = (nama, ...args) => electron.__listeners[nama]({}, ...args);
  return { electron, panggil, kirim, akar, dataDir, docsDir,
           sesi: () => JSON.parse(fs.readFileSync(path.join(dataDir, 'sessions.json'), 'utf8')) };
}

module.exports = { cek, hasil, tunggu, nyalakanAplikasi };
