/* =====================================================================
   penyimpanan.js — lokasi data, config.json, baca/tulis JSON yang aman,
   dan alat bantu nama file/folder. Dipakai semua modul lain di main/.
   ===================================================================== */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

/* ---------- Konfigurasi ---------- */
const bundledCfg = path.join(__dirname, '..', 'config.json');
const configPath = app.isPackaged ? path.join(app.getPath('userData'), 'config.json') : bundledCfg;
if (app.isPackaged && !fs.existsSync(configPath)) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.copyFileSync(bundledCfg, configPath);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

/* ---------- Lokasi data ---------- */
const userData = app.getPath('userData');
const defaultDir = path.join(app.getPath('documents'), 'VideoboothRecordings');
const settingsPath = path.join(userData, 'settings.json');
const sessionsPath = path.join(userData, 'sessions.json');
fs.mkdirSync(userData, { recursive: true });

function tryRead(p) {
  try { return { ok: true, data: JSON.parse(fs.readFileSync(p, 'utf8')) }; }
  catch (e) { return { ok: false, missing: e.code === 'ENOENT' }; }
}
// Baca file; kalau rusak, pakai cadangan (.bak). File rusak tidak pernah dibuang diam-diam.
function readJSON(p, fallback) {
  const a = tryRead(p);
  if (a.ok) return a.data;
  const b = tryRead(p + '.bak');
  if (b.ok) { if (!a.missing) console.log('File rusak, memakai cadangan: ' + p); return b.data; }
  if (!a.missing) {
    console.log('File rusak tanpa cadangan, salinannya disimpan: ' + p);
    try { fs.copyFileSync(p, p + '.corrupt-' + Date.now()); } catch (e) {}
  }
  return fallback;
}
// Tulis aman: tulis ke file sementara, simpan versi lama sebagai .bak, lalu ganti sekaligus.
// Kalau listrik mati di tengah jalan, file lama atau cadangannya tetap utuh.
function writeJSON(p, data) {
  const tmp = p + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (tryRead(p).ok) { try { fs.copyFileSync(p, p + '.bak'); } catch (e) {} }
  try { fs.renameSync(tmp, p); }
  catch (e) { fs.copyFileSync(tmp, p); try { fs.unlinkSync(tmp); } catch (e2) {} }  // cadangan jika rename diblokir (mis. antivirus)
}
const readSettings = () => readJSON(settingsPath, {});
const writeSettings = s => writeJSON(settingsPath, s);
const readSessions = () => readJSON(sessionsPath, []);
const writeSessions = l => writeJSON(sessionsPath, l);

// Pindahkan riwayat sesi versi lama (dulu disimpan di folder rekaman)
const oldSessions = path.join(defaultDir, 'sessions.json');
if (!fs.existsSync(sessionsPath) && fs.existsSync(oldSessions)) {
  const old = readJSON(oldSessions, []);
  old.forEach(s => { s.dir = s.dir || defaultDir; s.id = s.id || Date.parse(s.time) || Date.now(); });
  writeSessions(old);
}

const getOutDir = () => readSettings().outDir || defaultDir;

// Nama couple -> nama yang aman untuk folder & file di Windows dan Mac
function safeName(name) {
  const s = String(name || '')
    .replace(/[<>:"\/\\|?*\x00-\x1F]/g, '')   // karakter terlarang
    .replace(/\s+/g, ' ').trim()
    .replace(/[. ]+$/, '')                          // Windows: tidak boleh berakhir titik/spasi
    .slice(0, 60);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) ? s + '_' : s;
}
function coupleDir(base, name) {
  const n = safeName(name);
  return n ? path.join(base, n) : base;
}
function usableDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return true; }
  catch (e) { return false; }
}
function updateSession(id, patch) {
  const list = readSessions();
  const s = list.find(x => x.id === id);
  if (s) { Object.assign(s, patch); writeSessions(list); }
}

const pad = n => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

module.exports = {
  config, configPath, userData, defaultDir,
  readJSON, writeJSON, readSettings, writeSettings, readSessions, writeSessions, updateSession,
  getOutDir, usableDir, safeName, coupleDir, stamp
};
