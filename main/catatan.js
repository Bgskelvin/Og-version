/* =====================================================================
   catatan.js — catatan harian aplikasi (log), untuk melacak masalah
   setelah acara. Satu file teks per hari di folder data aplikasi:
       <folder data>/catatan/2026-11-06.txt
   Isi: aplikasi dibuka/ditutup, kamera tersambung/putus (+ kode error),
   rekaman & foto tersimpan/gagal, unggah QR, crash tampilan, dan semua
   console.log/console.error dari proses utama & tampilan.
   - Catatan lebih dari 30 hari dihapus otomatis.
   - Kalau menulis catatan gagal, aplikasi tetap berjalan (tamu tidak terganggu).
   - Jangan pernah mencatat password atau kunci booth.
   Di Admin → Aplikasi: "Lihat catatan" dan "Simpan catatan".
   ===================================================================== */
const { app, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const FOLDER = path.join(app.getPath('userData'), 'catatan');
const SIMPAN_HARI = 30;
const MAKS_BARIS = 2000; // satu baris catatan dipotong kalau lebih panjang dari ini
const TANDA = { info: ' ', peringatan: '⚠', error: '✗' };

const pad = n => String(n).padStart(2, '0');
const tanggal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const jam = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fileHari = (t = tanggal()) => path.join(FOLDER, t + '.txt');
const versi = () => {
  try {
    return app.getVersion();
  } catch {
    return '?';
  }
};

let siapFolder = false;
// Tulis satu baris. tingkat: 'info' | 'peringatan' | 'error'
function catat(pesan, tingkat = 'info') {
  try {
    if (!siapFolder) {
      fs.mkdirSync(FOLDER, { recursive: true });
      siapFolder = true;
    }
    const teks = String(pesan)
      .replace(/\s*\n\s*/g, ' ⏎ ')
      .slice(0, MAKS_BARIS);
    fs.appendFileSync(fileHari(), `${jam()} ${TANDA[tingkat] || ' '} ${teks}\n`);
  } catch {
    /* catatan gagal ditulis: jangan ganggu aplikasi */
  }
}
const peringatan = p => catat(p, 'peringatan');
const error = p => catat(p, 'error');

// Semua console.log / warn / error di proses utama ikut masuk catatan
let consoleTerpasang = false;
function pasangConsole() {
  if (consoleTerpasang) return;
  consoleTerpasang = true;
  const asli = { log: console.log, warn: console.warn, error: console.error };
  const gabung = a =>
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
    asli.log(...a);
    catat(gabung(a));
  };
  console.warn = (...a) => {
    asli.warn(...a);
    catat(gabung(a), 'peringatan');
  };
  console.error = (...a) => {
    asli.error(...a);
    catat(gabung(a), 'error');
  };
  process.on('uncaughtException', e => {
    asli.error(e);
    catat('Error tak tertangani: ' + ((e && e.stack) || e), 'error');
  });
  process.on('unhandledRejection', e => {
    asli.error(e);
    catat('Promise gagal tak tertangani: ' + ((e && e.stack) || e), 'error');
  });
}

// Hapus catatan yang lebih lama dari SIMPAN_HARI hari
function bersihkanLama() {
  try {
    const batas = Date.now() - SIMPAN_HARI * 86400000;
    for (const f of fs.readdirSync(FOLDER)) {
      const m = /^(\d{4})-(\d\d)-(\d\d)\.txt$/.exec(f);
      if (m && new Date(+m[1], +m[2] - 1, +m[3]).getTime() < batas) fs.unlinkSync(path.join(FOLDER, f));
    }
  } catch {
    /* catatan lama dicoba dihapus lagi saat aplikasi dibuka berikutnya */
  }
}
// Daftar file catatan, terbaru dulu
function daftar() {
  try {
    return fs
      .readdirSync(FOLDER)
      .filter(f => /^\d{4}-\d\d-\d\d\.txt$/.test(f))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function daftarkan() {
  // Baris dari tampilan (error JavaScript, crash kecil di layar tamu)
  ipcMain.on('catat', (e, pesan, tingkat) =>
    catat(
      '[tampilan] ' + String(pesan).slice(0, MAKS_BARIS),
      ['info', 'peringatan', 'error'].includes(tingkat) ? tingkat : 'info',
    ),
  );
  // Admin → "Lihat catatan": catatan hari terakhir (maks ±400 baris terakhir)
  ipcMain.handle('catatan-baca', () => {
    const files = daftar();
    if (!files.length) return { teks: '', file: '', hari: [] };
    let teks = '';
    try {
      teks = fs.readFileSync(path.join(FOLDER, files[0]), 'utf8');
    } catch {
      /* file catatan hari ini belum ada */
    }
    const baris = teks.split('\n');
    if (baris.length > 401) teks = '… (bagian awal tidak ditampilkan)\n' + baris.slice(-401).join('\n');
    return { teks, file: files[0].replace('.txt', ''), hari: files.map(f => f.replace('.txt', '')) };
  });
  // Admin → "Simpan catatan": gabungan 7 hari terakhir dalam satu file, untuk dikirim
  ipcMain.handle('catatan-simpan', async () => {
    const files = daftar().slice(0, 7).reverse();
    if (!files.length) return { error: 'No log entries yet.' };
    const r = await dialog.showSaveDialog({
      title: 'Save app log',
      defaultPath: path.join(app.getPath('downloads'), `Leura-catatan-${tanggal()}.txt`),
      filters: [{ name: 'Teks', extensions: ['txt'] }],
    });
    if (r.canceled || !r.filePath) return { batal: true };
    try {
      const isi = [
        `Catatan aplikasi Leura — disimpan ${tanggal()} ${jam()}`,
        `Versi ${versi()} · ${process.platform} ${require('os').release()}`,
        '',
      ];
      for (const f of files)
        isi.push(`===== ${f.replace('.txt', '')} =====`, fs.readFileSync(path.join(FOLDER, f), 'utf8'));
      fs.writeFileSync(r.filePath, isi.join('\n'));
      shell.showItemInFolder(r.filePath);
      catat('Catatan disimpan ke ' + r.filePath);
      return { ok: true, file: r.filePath };
    } catch (e) {
      return { error: 'Could not save: ' + e.message };
    }
  });
}

function mulai() {
  bersihkanLama();
  catat('────────── Aplikasi dibuka ──────────');
  catat(
    `Leura versi ${versi()} · ${process.platform} ${require('os').release()} · Electron ${process.versions.electron}`,
  );
}

module.exports = { catat, peringatan, error, pasangConsole, daftarkan, mulai, FOLDER, fileHari, tanggal };
