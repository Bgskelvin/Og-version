/* =====================================================================
   kamera-sony.js — kamera Sony (A6700) lewat USB
   Menjalankan kamera-sony/bin/sony-helper (program penghubung SDK Sony)
   sebagai proses terpisah dan menerjemahkan perintahnya untuk aplikasi.
   Mode "sony-sim" memakai kamera tiruan (kamera-sony/simulasi), jadi
   semua alur bisa dicoba tanpa kamera.

   Alur video: kamera merekam ke kartu SD → saat berhenti, file barunya
   disalin lewat USB ke folder couple (di belakang layar, satu per satu).
   ===================================================================== */
const { ipcMain } = require('electron');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { userData, readSettings } = require('./penyimpanan');
const { getWin } = require('./jendela-aktif');

const AKAR = path.join(__dirname, '..');
const HELPER = () => process.env.SONY_HELPER || path.join(AKAR, 'kamera-sony', 'bin', 'sony-helper');
const SIMULASI = path.join(AKAR, 'kamera-sony', 'simulasi');
const SEMENTARA = path.join(userData, 'sony-sementara');
const MODE = ['webcam', 'sony', 'sony-sim'];

/* ---------------- Program penghubung (proses terpisah) ---------------- */
class Helper extends EventEmitter {
  constructor(file) { super(); this.file = file; this.seq = 0; this.tunggu = new Map(); this.proc = null; }
  mulai() {
    const p = spawn(this.file, [], { cwd: path.dirname(this.file), stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = p;
    readline.createInterface({ input: p.stdout }).on('line', baris => {
      if (!baris.startsWith('{')) return;                 // abaikan tulisan lain dari SDK
      let m; try { m = JSON.parse(baris); } catch (e) { return; }
      if (m.ev) return this.emit('ev', m);
      const t = this.tunggu.get(m.id);
      if (t) { this.tunggu.delete(m.id); clearTimeout(t.timer); t.resolve(m); }
    });
    this.galat = '';
    p.stderr.on('data', d => { const t = String(d).trim(); if (t) { this.galat = t.split('\n').pop(); console.log('[sony-helper] ' + t); } });
    p.on('error', err => this.selesai('Program kamera Sony tidak bisa dijalankan: ' + err.message));
    p.on('exit', code => this.selesai('Program kamera Sony berhenti (kode ' + code + ')' + (this.galat ? ': ' + this.galat : '')));
    p.stdin.on('error', () => {});
  }
  selesai(pesan) {
    if (!this.proc) return;
    this.proc = null;
    for (const t of this.tunggu.values()) { clearTimeout(t.timer); t.resolve({ ok: false, error: pesan }); }
    this.tunggu.clear();
    this.emit('mati', pesan);
  }
  kirim(cmd, args = [], ms = 10000) {
    if (!this.proc) return Promise.resolve({ ok: false, error: 'Program kamera Sony tidak berjalan' });
    const id = ++this.seq;
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.tunggu.delete(id); resolve({ ok: false, error: 'Kamera tidak menjawab (' + cmd + ')' }); }, ms);
      this.tunggu.set(id, { resolve, timer });
      this.proc.stdin.write([id, cmd, ...args].join('\t') + '\n');
    });
  }
  berhenti() {
    const p = this.proc;
    if (!p) return;
    this.kirim('keluar', [], 3000);
    setTimeout(() => { try { p.kill(); } catch (e) {} }, 3000);
  }
}

/* ---------------- Kamera tiruan (mode simulasi) ---------------- */
class Simulasi extends EventEmitter {
  constructor() { super(); this.nyala = false; this.frame = 0; this.merekam = false; this.no = 1; this.unduhan = 0; }
  mulai() {
    this.lv = [];
    for (let i = 0; i < 8; i++) { try { this.lv.push(fs.readFileSync(path.join(SIMULASI, `lv${i}.jpg`))); } catch (e) {} }
    this.nyala = true;
  }
  berhenti() { this.nyala = false; }
  async kirim(cmd, args = []) {
    const tunda = ms => new Promise(r => setTimeout(r, ms));
    if (!this.nyala) return { ok: false, error: 'Simulasi mati' };
    switch (cmd) {
      case 'sambung': await tunda(300); this.tersambung = true; return { ok: true, model: 'ILCE-6700 (simulasi)' };
      case 'status': return { ok: true, tersambung: !!this.tersambung, model: 'ILCE-6700 (simulasi)', baterai: 100, kartu: 0,
        sisaDetik: 9000, sisaFoto: 2500, merekam: this.merekam, mengunduh: this.unduhan > 0 };
      case 'lv': await tunda(30); return this.lv.length ? { ok: true, buf: this.lv[this.frame++ % this.lv.length] } : { ok: false, error: 'Tidak ada gambar simulasi' };
      case 'foto': {
        await tunda(450);
        const f = path.join(args[0], `DSC${String(++this.no).padStart(5, '0')}.JPG`);
        fs.copyFileSync(path.join(SIMULASI, 'foto.jpg'), f);
        return { ok: true, file: f, ms: 450 };
      }
      case 'rekam-mulai': await tunda(200); this.merekam = true; return { ok: true };
      case 'rekam-stop': {
        await tunda(400); this.merekam = false;
        const n = ++this.no;
        return { ok: true, slot: 1, contentId: n, fileId: 1, nama: `C${String(n).padStart(4, '0')}.MP4`, ukuran: fs.statSync(path.join(SIMULASI, 'video.mp4')).size };
      }
      case 'unduh': {
        const job = Date.now();
        this.unduhan++;
        setTimeout(() => this.emit('ev', { ev: 'unduh-progres', job, persen: 50 }), 300);
        setTimeout(() => {
          this.unduhan--;
          const f = path.join(args[3], `C${String(args[1]).padStart(4, '0')}.MP4`);
          try { fs.copyFileSync(path.join(SIMULASI, 'video.mp4'), f); this.emit('ev', { ev: 'unduh-selesai', job, file: f }); }
          catch (e) { this.emit('ev', { ev: 'unduh-gagal', job, kode: e.message }); }
        }, 900);
        return { ok: true, job };
      }
      case 'keluar': return { ok: true };
      default: return { ok: false, error: 'Perintah tidak dikenal: ' + cmd };
    }
  }
}

/* ---------------- Pengelola kamera ---------------- */
let mode = 'webcam', hub = null, timerSambung = null, timerStatus = null, menyambung = false;
let st = { tersambung: false, model: '', pesan: '' };
const unduhTunggu = new Map();     // job -> { resolve }
let antrianUnduh = Promise.resolve();

function kabarkan() {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('sony-status', status());
}
function status() { return { mode, ...st }; }

function jadwalSambung(ms) {
  clearTimeout(timerSambung);
  if (mode === 'webcam' || !hub) return;
  timerSambung = setTimeout(cobaSambung, ms);
}
async function cobaSambung() {
  if (!hub || st.tersambung || menyambung) return;
  menyambung = true;
  fs.mkdirSync(SEMENTARA, { recursive: true });
  const r = await hub.kirim('sambung', [SEMENTARA], 30000);
  menyambung = false;
  if (!hub) return;
  if (r.ok) {
    Object.assign(st, { tersambung: true, model: r.model || 'Sony', pesan: '' });
    if (r.catatan) console.log('Kamera Sony: sebagian pengaturan gagal dipasang: ' + r.catatan);
    await perbaruiStatus();
  } else {
    Object.assign(st, { tersambung: false, pesan: r.error || 'Kamera Sony belum tersambung' });
    jadwalSambung(4000);
  }
  kabarkan();
}
async function perbaruiStatus() {
  if (!hub || !st.tersambung) return;
  const r = await hub.kirim('status', [], 5000);
  if (r.ok && r.tersambung) {
    const { baterai, kartu, sisaDetik, sisaFoto, merekam, mengunduh } = r;
    Object.assign(st, { baterai, kartu, sisaDetik, sisaFoto, merekam, mengunduh });
    kabarkan();
  }
}

function olahKabar(m) {
  if (m.ev === 'terputus') {
    Object.assign(st, { tersambung: false, pesan: 'Kamera Sony terputus. Cek kabel USB & daya kamera.' });
    // SDK mencoba menyambung ulang sendiri; kalau 8 detik belum berhasil, aplikasi mencari kamera lagi
    jadwalSambung(8000);
    for (const t of unduhTunggu.values()) t.resolve({ ok: false, error: 'Kamera terputus saat menyalin video' });
    unduhTunggu.clear();
  } else if (m.ev === 'menyambung-ulang') {
    Object.assign(st, { tersambung: false, pesan: 'Menyambung ulang ke kamera…' });
  } else if (m.ev === 'tersambung') {
    Object.assign(st, { tersambung: true, pesan: '' });
    clearTimeout(timerSambung);
  } else if (m.ev === 'unduh-selesai' || m.ev === 'unduh-gagal') {
    const t = unduhTunggu.get(m.job);
    if (t) { unduhTunggu.delete(m.job); t.resolve(m.ev === 'unduh-selesai' ? { ok: true, file: m.file } : { ok: false, error: 'Gagal menyalin video (' + m.kode + ')' }); }
    return;
  } else return;
  kabarkan();
}

// Ganti sumber kamera: 'webcam' | 'sony' | 'sony-sim'
function setel(m) {
  m = MODE.includes(m) ? m : 'webcam';
  if (m === mode && (hub || m === 'webcam')) return status();
  matikan();
  mode = m;
  st = { tersambung: false, model: '', pesan: '' };
  if (m === 'webcam') { kabarkan(); return status(); }
  if (m === 'sony') {
    const file = HELPER();
    if (!fs.existsSync(file)) {
      st.pesan = process.platform === 'darwin' || process.env.SONY_HELPER
        ? 'Program kamera Sony belum dibuat. Jalankan di Terminal: npm run build:sony'
        : 'Kamera Sony lewat USB hanya bisa dipakai di Mac.';
      kabarkan();
      return status();
    }
    hub = new Helper(file);
  } else hub = new Simulasi();
  const ini = hub;
  hub.on('ev', olahKabar);
  hub.on('mati', pesan => {
    if (hub !== ini) return;
    Object.assign(st, { tersambung: false, pesan });
    kabarkan();
    // program penghubung berhenti mendadak: nyalakan lagi
    setTimeout(() => { if (hub === ini && mode === 'sony') { ini.mulai(); jadwalSambung(500); } }, 3000);
  });
  hub.mulai();
  jadwalSambung(0);
  clearInterval(timerStatus);
  timerStatus = setInterval(perbaruiStatus, 15000);
  return status();
}
function matikan() {
  clearTimeout(timerSambung); clearInterval(timerStatus);
  if (hub) { const h = hub; hub = null; if (st.merekam) h.kirim('rekam-stop', [], 3000); h.berhenti(); }
  for (const t of unduhTunggu.values()) t.resolve({ ok: false, error: 'Kamera Sony dimatikan' });
  unduhTunggu.clear();
}

/* ---------------- Fungsi untuk fitur lain ---------------- */
const pakaiSony = () => mode !== 'webcam';
const siap = () => !!hub && st.tersambung;

async function liveView() {
  if (!siap()) return null;
  const r = await hub.kirim('lv', [], 3000);
  if (!r.ok) return null;
  return r.buf || Buffer.from(r.jpg, 'base64');
}
async function foto() {
  if (!siap()) return { error: st.pesan || 'Kamera Sony belum tersambung' };
  fs.mkdirSync(SEMENTARA, { recursive: true });
  const r = await hub.kirim('foto', [SEMENTARA], 20000);
  if (!r.ok) return { error: r.error };
  try {
    const bytes = fs.readFileSync(r.file);
    fs.unlink(r.file, () => {});           // salinan asli tetap ada di kartu SD kamera
    return { ok: true, bytes, ms: r.ms };
  } catch (err) { return { error: 'Foto masuk tapi tidak bisa dibaca: ' + err.message }; }
}
async function rekamMulai() {
  if (!siap()) return { error: st.pesan || 'Kamera Sony belum tersambung' };
  const r = await hub.kirim('rekam-mulai', [], 10000);
  if (r.ok) { st.merekam = true; kabarkan(); }
  return r.ok ? { ok: true } : { error: r.error };
}
async function rekamStop() {
  if (!hub) return { error: 'Kamera Sony tidak aktif' };
  const r = await hub.kirim('rekam-stop', [], 45000);
  st.merekam = false; kabarkan();
  return r.ok ? r : { error: r.error };
}
// Salin video dari kartu ke `tujuan` (path lengkap .mp4). Antre satu per satu.
function unduh(info, tujuan) {
  const kerja = antrianUnduh.then(async () => {
    if (!siap()) return { error: 'Kamera Sony belum tersambung' };
    const dir = path.join(SEMENTARA, 'video-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    const r = await hub.kirim('unduh', [info.slot, info.contentId, info.fileId, dir], 15000);
    if (!r.ok) return { error: r.error };
    const hasil = await new Promise(resolve => {
      const batas = setTimeout(() => { unduhTunggu.delete(r.job); resolve({ ok: false, error: 'Menyalin video terlalu lama' }); }, 20 * 60000);
      unduhTunggu.set(r.job, { resolve: v => { clearTimeout(batas); resolve(v); } });
    });
    if (!hasil.ok) return { error: hasil.error };
    try {
      try { fs.renameSync(hasil.file, tujuan); }
      catch (e) { fs.copyFileSync(hasil.file, tujuan); fs.unlinkSync(hasil.file); }   // beda disk (SSD luar)
      fs.rm(dir, { recursive: true, force: true }, () => {});
      return { ok: true, file: tujuan };
    } catch (err) { return { error: 'Video tersalin tapi gagal dipindah ke folder couple: ' + err.message }; }
  });
  antrianUnduh = kerja.catch(() => {});
  return kerja;
}

function daftarkan() {
  ipcMain.handle('sony-status', () => status());
  ipcMain.handle('sony-lv', () => liveView());
  ipcMain.handle('sony-foto', () => foto());
  ipcMain.handle('sony-sambung-ulang', () => {
    if (!hub) { const m = mode; mode = 'webcam'; return setel(m); }   // mis. program penghubung baru saja dibuat
    st.tersambung = false; menyambung = false; jadwalSambung(0); return status();
  });
}
// Saat aplikasi dibuka: bersihkan sisa file sementara, lalu pakai sumber kamera dari pengaturan
function mulai() {
  try { fs.rmSync(SEMENTARA, { recursive: true, force: true }); } catch (e) {}
  setel(readSettings().kamera);
}

module.exports = { daftarkan, mulai, setel, matikan, status, pakaiSony, siap, foto, rekamMulai, rekamStop, unduh, MODE };
