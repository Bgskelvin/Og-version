/* =====================================================================
   foto.js — menyimpan hasil Photo Booth (4 foto asli + 1 hasil edit)
   ===================================================================== */
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const catatan = require('./catatan');
const { defaultDir, readSessions, writeSessions, getOutDir, usableDir, safeName, coupleDir, stamp, namaTamu, namaBebas } = require('./penyimpanan');
const { activeCoupleName } = require('./couple');
const unggah = require('./unggah');

function daftarkan() {
  // ---------- Photo Booth: simpan 4 foto asli + 1 hasil edit ----------
  // Lokasi: <folder penyimpanan>/<nama couple>/Foto/
  ipcMain.handle('save-photos', async (e, payload) => {
    try {
      const { originals = [], result, satuan = [], meta = {}, tamu: tamuAsli } = payload || {};
      if (!result || !originals.length) { catatan.error('Simpan foto ditolak: data foto kosong'); return { ok: false, error: 'No photo data' }; }
      const name = activeCoupleName();
      let base = getOutDir();
      if (!usableDir(base)) { base = defaultDir; if (!usableDir(base)) return { ok: false, error: 'The storage folder is not writable.' }; }
      const dir = path.join(coupleDir(base, name), 'Foto');
      if (!usableDir(dir)) return { ok: false, error: 'Could not create the photo folder.' };
      // Nama file: nama tamu, mis. "Budi_hasil.jpg" + "Budi_foto-1.jpg"…; tanpa nama tamu: "<couple>_<waktu>_hasil.jpg".
      // Nama yang sudah dipakai tidak ditimpa: "Budi_2_hasil.jpg".
      const tamu = namaTamu(tamuAsli);
      const dasar = tamu || (safeName(name) ? safeName(name) + '_' : '') + stamp();
      const prefix = namaBebas(dasar, b => fs.existsSync(path.join(dir, `${b}_hasil.jpg`)) || fs.existsSync(path.join(dir, `${b}_foto-1.jpg`)));
      const files = [];
      for (let i = 0; i < originals.length; i++) {
        const f = `${prefix}_foto-${i + 1}.jpg`;
        await fs.promises.writeFile(path.join(dir, f), Buffer.from(originals[i]));
        files.push(f);
      }
      const hasil = `${prefix}_hasil.jpg`;
      await fs.promises.writeFile(path.join(dir, hasil), Buffer.from(result));
      // Unduh lewat QR (kalau dinyalakan di Admin): kode & link langsung ada, unggahnya menyusul di belakang
      const sid = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      let qr = null;
      try {
        const list = readSessions();
        // Foto satuan (tanpa template) ikut diunggah supaya tamu bisa mengunduhnya juga
        const fileSatuan = unggah.siap() ? await unggah.simpanSatuan(sid, satuan) : [];
        qr = unggah.daftarkanFoto(path.join(dir, hasil), sid, { satuan: fileSatuan, couple: name });
        list.push({ id: sid, time: new Date().toISOString(), label: 'foto', file: hasil, dir, couple: name, ...(tamu ? { tamu: String(tamuAsli).trim().slice(0, 40) } : {}), seconds: 0, status: 'photo',
          photos: originals.length, originalFiles: files, ...(qr ? { kode: qr.kode, link: qr.link, unggah: 'antre' } : {}), ...meta });
        writeSessions(list);
      } catch (err) { console.log('Gagal mencatat sesi foto: ' + err.message); }
      catatan.catat(`Foto tersimpan: ${hasil} (+${originals.length} foto asli)${qr ? ', QR ' + qr.kode : ''}`);
      return { ok: true, file: path.join(dir, hasil), link: qr ? qr.link : null };
    } catch (err) {
      catatan.error('Gagal menyimpan foto: ' + err.message);
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { daftarkan };
