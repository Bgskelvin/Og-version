/* =====================================================================
   keluar.js — tombol "Tutup aplikasi" di Admin.
   Menutup lewat jalur resmi (app.quit), sehingga di main.js rekaman
   ditutup dan kamera Sony diputus dengan rapi sebelum aplikasi berhenti.
   ===================================================================== */
const { ipcMain, app } = require('electron');
const { readSessions } = require('./penyimpanan');
const unggah = require('./unggah');

// Hal yang masih berjalan, untuk peringatan sebelum menutup
function cekSebelumTutup() {
  let salin = 0, proses = 0;
  try {
    for (const s of readSessions()) {
      if (s.status === 'transfer') salin++;
      else if (s.status === 'processing') proses++;
    }
  } catch (e) {}
  let foto = 0;
  try { foto = unggah.status().menunggu || 0; } catch (e) {}
  return { salin, proses, foto };
}

function daftarkan() {
  ipcMain.handle('cek-tutup', () => cekSebelumTutup());
  ipcMain.handle('tutup-aplikasi', () => { setTimeout(() => app.quit(), 300); return { ok: true }; });
}

module.exports = { daftarkan, cekSebelumTutup };
