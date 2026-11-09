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
const { spawn, execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { userData, readSettings } = require('./penyimpanan');
const { getWin } = require('./jendela-aktif');

const AKAR = path.join(__dirname, '..');
// Program penghubung + pustaka SDK Sony: di Leura.app ada di Contents/Resources/kamera-sony/bin
// (disalin oleh installer, di luar app.asar supaya bisa dijalankan), saat npm start di folder kode.
const { app } = require('electron');
const FOLDER_BIN = () =>
  app && app.isPackaged
    ? path.join(process.resourcesPath, 'kamera-sony', 'bin')
    : path.join(AKAR, 'kamera-sony', 'bin');
const HELPER = () => process.env.SONY_HELPER || path.join(FOLDER_BIN(), 'sony-helper');
const SIMULASI = path.join(AKAR, 'kamera-sony', 'simulasi');
const SEMENTARA = path.join(userData, 'sony-sementara');
const MODE = ['webcam', 'sony', 'sony-sim'];

/* ---------------- Program penghubung (proses terpisah) ---------------- */
// Program penghubung yang tertinggal dari aplikasi sebelumnya (misalnya dihentikan paksa) bisa terus
// memegang kamera sehingga kamera tidak menjawab (error 0x8208). Hentikan sekali saat aplikasi mulai.
let sudahBersih = false;
function bersihkanSisa(file) {
  if (sudahBersih || process.platform !== 'darwin') return;
  sudahBersih = true;
  try {
    execFileSync('pkill', ['-f', file], { timeout: 3000 });
    console.log('Kamera Sony: program penghubung lama yang tertinggal dihentikan.');
  } catch {
    /* tidak ada yang tertinggal */
  }
}
class Helper extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.seq = 0;
    this.tunggu = new Map();
    this.proc = null;
  }
  mulai() {
    bersihkanSisa(this.file);
    // detached: Ctrl+C di Terminal tidak ikut mematikan program ini secara kasar. Kalau aplikasi
    // berhenti, stdin-nya tertutup dan program ini memutus sambungan kamera dengan rapi sendiri.
    const p = spawn(this.file, [], { cwd: path.dirname(this.file), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    this.proc = p;
    readline.createInterface({ input: p.stdout }).on('line', baris => {
      if (!baris.startsWith('{')) return; // abaikan tulisan lain dari SDK
      let m;
      try {
        m = JSON.parse(baris);
      } catch {
        return;
      }
      if (m.ev) return this.emit('ev', m);
      const t = this.tunggu.get(m.id);
      if (t) {
        this.tunggu.delete(m.id);
        clearTimeout(t.timer);
        t.resolve(m);
      }
    });
    this.galat = '';
    p.stderr.on('data', d => {
      const t = String(d).trim();
      if (t) {
        this.galat = t.split('\n').pop();
        console.log('[sony-helper] ' + t);
      }
    });
    p.on('error', err => this.selesai('The Sony camera helper could not start: ' + err.message));
    p.on('exit', code =>
      this.selesai('The Sony camera helper stopped (code ' + code + ')' + (this.galat ? ': ' + this.galat : '')),
    );
    p.stdin.on('error', () => {});
  }
  selesai(pesan) {
    if (!this.proc) return;
    this.proc = null;
    for (const t of this.tunggu.values()) {
      clearTimeout(t.timer);
      t.resolve({ ok: false, error: pesan });
    }
    this.tunggu.clear();
    this.emit('mati', pesan);
  }
  kirim(cmd, args = [], ms = 10000) {
    if (!this.proc) return Promise.resolve({ ok: false, error: 'The Sony camera helper is not running' });
    const id = ++this.seq;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.tunggu.delete(id);
        resolve({ ok: false, error: 'The camera did not respond (' + cmd + ')' });
      }, ms);
      this.tunggu.set(id, { resolve, timer });
      this.proc.stdin.write([id, cmd, ...args].join('\t') + '\n');
    });
  }
  // Minta program memutus kamera dengan rapi; selesai saat programnya benar-benar berhenti (maks 4 detik)
  berhenti() {
    const p = this.proc;
    if (!p) return Promise.resolve();
    return new Promise(resolve => {
      const paksa = setTimeout(() => {
        try {
          p.kill();
        } catch {
          /* program sudah berhenti sendiri */
        }
        resolve();
      }, 4000);
      p.once('exit', () => {
        clearTimeout(paksa);
        resolve();
      });
      this.kirim('keluar', [], 3000);
      try {
        p.stdin.end();
      } catch {
        /* saluran input program sudah tertutup */
      }
    });
  }
}

/* ---------------- Kamera tiruan (mode simulasi) ---------------- */
class Simulasi extends EventEmitter {
  constructor() {
    super();
    this.nyala = false;
    this.frame = 0;
    this.merekam = false;
    this.no = 1;
    this.unduhan = 0;
  }
  mulai() {
    this.lv = [];
    for (let i = 0; i < 8; i++) {
      try {
        this.lv.push(fs.readFileSync(path.join(SIMULASI, `lv${i}.jpg`)));
      } catch {
        /* gambar simulasi ke-i tidak ada: dilewati */
      }
    }
    this.nyala = true;
  }
  berhenti() {
    this.nyala = false;
  }
  async kirim(cmd, args = []) {
    const tunda = ms => new Promise(r => setTimeout(r, ms));
    if (!this.nyala) return { ok: false, error: 'Simulation is off' };
    switch (cmd) {
      case 'sambung':
        await tunda(300);
        this.tersambung = true;
        return { ok: true, model: 'ILCE-6700 (simulasi)' };
      case 'status':
        return {
          ok: true,
          tersambung: !!this.tersambung,
          model: 'ILCE-6700 (simulasi)',
          baterai: 100,
          kartu: 0,
          sisaDetik: 9000,
          sisaFoto: 2500,
          merekam: this.merekam,
          mengunduh: this.unduhan > 0,
        };
      case 'lv':
        await tunda(30);
        return this.lv.length
          ? { ok: true, buf: this.lv[this.frame++ % this.lv.length] }
          : { ok: false, error: 'No simulation image' };
      case 'foto': {
        await tunda(450);
        const f = path.join(args[0], `DSC${String(++this.no).padStart(5, '0')}.JPG`);
        fs.copyFileSync(path.join(SIMULASI, 'foto.jpg'), f);
        return { ok: true, file: f, ms: 450 };
      }
      case 'rekam-mulai':
        await tunda(200);
        this.merekam = true;
        return { ok: true };
      case 'mode': {
        const jenis = this.jenisMode || 'foto';
        if (!args[0] || args[0] === jenis)
          return { ok: true, jenis, mode: jenis === 'video' ? '0x8050' : '0x1', diubah: false };
        await tunda(300);
        this.jenisMode = args[0];
        return { ok: true, jenis: args[0], mode: args[0] === 'video' ? '0x8050' : '0x1', diubah: true, coba: 1 };
      }
      case 'rekam-stop': {
        await tunda(400);
        this.merekam = false;
        const n = ++this.no;
        return {
          ok: true,
          slot: 1,
          contentId: n,
          fileId: 1,
          nama: `C${String(n).padStart(4, '0')}.MP4`,
          ukuran: fs.statSync(path.join(SIMULASI, 'video.mp4')).size,
        };
      }
      case 'unduh': {
        const job = Date.now();
        this.unduhan++;
        setTimeout(() => this.emit('ev', { ev: 'unduh-progres', job, persen: 50 }), 300);
        setTimeout(() => {
          this.unduhan--;
          const f = path.join(args[3], `C${String(args[1]).padStart(4, '0')}.MP4`);
          try {
            fs.copyFileSync(path.join(SIMULASI, 'video.mp4'), f);
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

/* ---------------- Pengelola kamera ---------------- */
let mode = 'webcam',
  hub = null,
  timerSambung = null,
  timerStatus = null,
  menyambung = false;
let st = { tersambung: false, model: '', pesan: '' };
const unduhTunggu = new Map(); // job -> { resolve }
let antrianUnduh = Promise.resolve();

function kabarkan() {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('sony-status', status());
}
function status() {
  return { mode, ...st };
}

function jadwalSambung(ms) {
  clearTimeout(timerSambung);
  if (mode === 'webcam' || !hub) return;
  timerSambung = setTimeout(cobaSambung, ms);
}
const { jelaskanSambung } = require('./pesan-sony');
const catatan = require('./catatan');
let pesanGagalTerakhir = '';
let sudahPotretBerhasil = false;
// Potret kondisi Mac ke catatan (program yang mungkin merebut kamera, USB, disk). Tidak menunggu, tidak pernah gagal.
function catatKondisiMac(alasan) {
  require('./diagnosa-mac')
    .potret()
    .then(b => b.forEach(x => catatan.catat(`  [kondisi Mac · ${alasan}] ${x}`)))
    .catch(() => {});
} // supaya gagal sambung yang sama (dicoba tiap 4 dtk) tidak memenuhi catatan
async function cobaSambung() {
  if (!hub || st.tersambung || menyambung) return;
  menyambung = true;
  fs.mkdirSync(SEMENTARA, { recursive: true });
  const r = await hub.kirim('sambung', [SEMENTARA], 30000);
  menyambung = false;
  if (!hub) return;
  if (r.ok) {
    Object.assign(st, { tersambung: true, model: r.model || 'Sony', pesan: '' });
    catatan.catat(`Kamera Sony tersambung: ${st.model}`);
    st.jenisMode = null;
    hub
      .kirim('mode', [], 5000)
      .then(m => {
        if (m && m.ok) {
          st.jenisMode = m.jenis;
          catatan.catat(`Mode kamera saat tersambung: ${m.jenis.toUpperCase()} (${m.mode})`);
        }
      })
      .catch(() => {});
    if (!sudahPotretBerhasil) {
      sudahPotretBerhasil = true;
      catatKondisiMac('berhasil');
    }
    pesanGagalTerakhir = '';
    if (r.catatan) console.log('Kamera Sony: sebagian pengaturan gagal dipasang: ' + r.catatan);
    await perbaruiStatus();
  } else {
    Object.assign(st, { tersambung: false, pesan: jelaskanSambung(r) });
    if (st.pesan !== pesanGagalTerakhir) {
      catatan.peringatan('Kamera Sony gagal tersambung: ' + st.pesan + ' (dicoba lagi tiap 4 detik)');
      pesanGagalTerakhir = st.pesan;
      catatKondisiMac('gagal ' + (r.kode || ''));
    }
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
    Object.assign(st, {
      tersambung: false,
      pesan: 'Sony camera disconnected. Check the USB cable and camera power.',
      jenisMode: null,
    });
    catatan.peringatan('Kamera Sony terputus' + (m.kode ? ' (' + m.kode + ')' : ''));
    // SDK mencoba menyambung ulang sendiri; kalau 8 detik belum berhasil, aplikasi mencari kamera lagi
    jadwalSambung(8000);
    for (const t of unduhTunggu.values())
      t.resolve({ ok: false, error: 'The camera disconnected while copying the video' });
    unduhTunggu.clear();
  } else if (m.ev === 'menyambung-ulang') {
    Object.assign(st, { tersambung: false, pesan: 'Reconnecting to the camera…' });
  } else if (m.ev === 'tersambung') {
    Object.assign(st, { tersambung: true, pesan: '' });
    catatan.catat('Kamera Sony tersambung lagi');
    clearTimeout(timerSambung);
  } else if (m.ev === 'unduh-selesai' || m.ev === 'unduh-gagal') {
    const t = unduhTunggu.get(m.job);
    if (m.ev === 'unduh-gagal') catatan.error('Gagal menyalin video dari kartu kamera (' + m.kode + ')');
    if (t) {
      unduhTunggu.delete(m.job);
      t.resolve(
        m.ev === 'unduh-selesai'
          ? { ok: true, file: m.file }
          : { ok: false, error: 'Could not copy the video (' + m.kode + ')' },
      );
    }
    return;
  } else return;
  kabarkan();
}

// Ganti sumber kamera: 'webcam' | 'sony' | 'sony-sim'
function setel(m) {
  m = MODE.includes(m) ? m : 'webcam';
  if (m === mode && (hub || m === 'webcam')) return status();
  matikan();
  modeTakDidukung = false; // program penghubung baru bisa saja sudah mendukung ganti mode
  catatan.catat('Sumber kamera: ' + m);
  mode = m;
  st = { tersambung: false, model: '', pesan: '' };
  if (m === 'webcam') {
    kabarkan();
    return status();
  }
  if (m === 'sony') {
    const file = HELPER();
    if (!fs.existsSync(file)) {
      st.pesan =
        process.platform !== 'darwin' && !process.env.SONY_HELPER
          ? 'A Sony camera over USB only works on a Mac.'
          : app && app.isPackaged
            ? 'The Sony camera helper is missing from this Leura.app. Build the installer again with: npm run build:mac'
            : 'The Sony camera helper is not built yet. Run in Terminal: npm run build:sony';
      kabarkan();
      return status();
    }
    hub = new Helper(file);
  } else hub = new Simulasi();
  const ini = hub;
  hub.on('ev', olahKabar);
  hub.on('mati', pesan => {
    if (hub !== ini) return;
    catatan.error(pesan + ' — dinyalakan lagi dalam 3 detik');
    Object.assign(st, { tersambung: false, pesan });
    kabarkan();
    // program penghubung berhenti mendadak: nyalakan lagi
    setTimeout(() => {
      if (hub === ini && mode === 'sony') {
        ini.mulai();
        jadwalSambung(500);
      }
    }, 3000);
  });
  hub.mulai();
  jadwalSambung(0);
  clearInterval(timerStatus);
  timerStatus = setInterval(perbaruiStatus, 15000);
  return status();
}
function matikan() {
  clearTimeout(timerSambung);
  clearInterval(timerStatus);
  let selesai = Promise.resolve();
  if (hub) {
    const h = hub;
    hub = null;
    if (st.merekam) h.kirim('rekam-stop', [], 3000);
    selesai = h.berhenti();
  }
  for (const t of unduhTunggu.values()) t.resolve({ ok: false, error: 'Sony camera turned off' });
  unduhTunggu.clear();
  return selesai;
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
/* ---------- Mode kamera: foto / video (tanpa memutar tombol di kamera) ----------
   Kirim pesan & Quiz → mode VIDEO (live view 16:9 = sama dengan hasil video).
   Photo booth → mode FOTO (resolusi penuh, live view 3:2).
   Kamera kembali ke mode foto/video terakhir yang dipakai operator (mis. M).
   Kalau program penghubung lama (belum npm run build:sony) atau kamera menolak,
   booth tetap jalan seperti sebelumnya. */
let antrianMode = Promise.resolve();
let modeTakDidukung = false;
function aturMode(jenis) {
  if (!['foto', 'video'].includes(jenis) || !siap() || modeTakDidukung)
    return Promise.resolve({ ok: false, dilewati: true });
  if (st.jenisMode === jenis) return Promise.resolve({ ok: true, jenis, diubah: false });
  const kerja = antrianMode.then(async () => {
    if (!siap()) return { ok: false };
    if (st.jenisMode === jenis) return { ok: true, jenis, diubah: false };
    const r = await hub.kirim('mode', [jenis], 15000);
    if (r.ok) {
      st.jenisMode = r.jenis;
      if (r.diubah) catatan.catat(`Mode kamera: ${r.jenis.toUpperCase()} (${r.mode}, ${r.coba || 1}x coba)`);
      kabarkan();
    } else if (/Perintah tidak dikenal|Unknown command/.test(r.error || '')) {
      modeTakDidukung = true;
      catatan.peringatan('Ganti mode foto/video belum tersedia: jalankan npm run build:sony');
    } else catatan.peringatan(`Mode kamera tidak bisa diganti ke ${jenis}: ${r.error}`);
    return r;
  });
  antrianMode = kerja.catch(() => {});
  return kerja;
}

async function foto() {
  if (!siap()) return { error: st.pesan || 'Kamera Sony belum tersambung' };
  await aturMode('foto');
  fs.mkdirSync(SEMENTARA, { recursive: true });
  const r = await hub.kirim('foto', [SEMENTARA], 20000);
  if (!r.ok) return { error: r.error };
  try {
    const bytes = fs.readFileSync(r.file);
    fs.unlink(r.file, () => {}); // salinan asli tetap ada di kartu SD kamera
    return { ok: true, bytes, ms: r.ms };
  } catch (err) {
    return { error: 'The photo arrived but could not be read: ' + err.message };
  }
}
async function rekamMulai() {
  if (!siap()) return { error: st.pesan || 'Kamera Sony belum tersambung' };
  await aturMode('video');
  const r = await hub.kirim('rekam-mulai', [], 10000);
  if (r.ok) {
    st.merekam = true;
    kabarkan();
  }
  return r.ok ? { ok: true } : { error: r.error };
}
async function rekamStop() {
  if (!hub) return { error: 'The Sony camera is not active' };
  const r = await hub.kirim('rekam-stop', [], 45000);
  st.merekam = false;
  kabarkan();
  return r.ok ? r : { error: r.error };
}
// Salin video dari kartu ke `tujuan` (path lengkap .mp4). Antre satu per satu.
function unduh(info, tujuan) {
  const kerja = antrianUnduh.then(async () => {
    if (!siap()) return { error: 'The Sony camera is not connected yet' };
    const dir = path.join(SEMENTARA, 'video-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    const r = await hub.kirim('unduh', [info.slot, info.contentId, info.fileId, dir], 15000);
    if (!r.ok) return { error: r.error };
    const hasil = await new Promise(resolve => {
      const batas = setTimeout(() => {
        unduhTunggu.delete(r.job);
        resolve({ ok: false, error: 'Copying the video took too long' });
      }, 20 * 60000);
      unduhTunggu.set(r.job, {
        resolve: v => {
          clearTimeout(batas);
          resolve(v);
        },
      });
    });
    if (!hasil.ok) return { error: hasil.error };
    try {
      try {
        fs.renameSync(hasil.file, tujuan);
      } catch {
        fs.copyFileSync(hasil.file, tujuan);
        fs.unlinkSync(hasil.file);
      } // beda disk (SSD luar)
      fs.rm(dir, { recursive: true, force: true }, () => {});
      return { ok: true, file: tujuan };
    } catch (err) {
      return { error: 'The video was copied but could not be moved to the couple folder: ' + err.message };
    }
  });
  antrianUnduh = kerja.catch(() => {});
  return kerja;
}

function daftarkan() {
  ipcMain.handle('sony-status', () => status());
  ipcMain.handle('sony-lv', () => liveView());
  ipcMain.handle('sony-foto', () => foto());
  ipcMain.handle('sony-mode', (e, jenis) => aturMode(jenis));
  ipcMain.handle('sony-sambung-ulang', () => {
    if (!hub) {
      const m = mode;
      mode = 'webcam';
      return setel(m);
    } // mis. program penghubung baru saja dibuat
    st.tersambung = false;
    menyambung = false;
    jadwalSambung(0);
    return status();
  });
}
// Saat aplikasi dibuka: bersihkan sisa file sementara, lalu pakai sumber kamera dari pengaturan
function mulai() {
  try {
    fs.rmSync(SEMENTARA, { recursive: true, force: true });
  } catch {
    /* folder sementara belum ada */
  }
  setel(readSettings().kamera);
}

module.exports = {
  daftarkan,
  mulai,
  setel,
  matikan,
  status,
  pakaiSony,
  siap,
  foto,
  rekamMulai,
  rekamStop,
  unduh,
  MODE,
};
