/* =====================================================================
   rekaman.js — perekaman video: menulis file, konversi ke MP4 (FFmpeg),
   pencatatan sesi, dan pemulihan rekaman yang terputus.
   Dengan kamera Sony: kamera merekam ke kartu SD, lalu file MP4-nya
   disalin ke folder couple di belakang layar (lihat kamera-sony.js).
   ===================================================================== */
const { ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { defaultDir, readSessions, writeSessions, updateSession, getOutDir, usableDir, safeName, coupleDir, stamp, namaTamu, namaBebas } = require('./penyimpanan');
const { activeCoupleName } = require('./couple');
const { getWin } = require('./jendela-aktif');
const sony = require('./kamera-sony');
const catatan = require('./catatan');

/* ---------- FFmpeg: .webm -> .mp4 ---------- */
let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
} catch (e) {
  console.log('ffmpeg-static belum terpasang: rekaman tetap disimpan sebagai .webm');
}

let convChain = Promise.resolve();
function convert(id, webmPath) {
  if (!ffmpegPath) { updateSession(id, { status: 'webm' }); return; }
  convChain = convChain.then(() => new Promise(resolve => {
    const mp4 = webmPath.replace(/\.webm$/i, '.mp4');
    const p = spawn(ffmpegPath, [
      '-y', '-fflags', '+genpts', '-i', webmPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', mp4
    ], { stdio: 'ignore' });
    p.on('error', err => { catatan.error(`Ubah ke MP4 gagal (${path.basename(webmPath)}): ${err.message}`); updateSession(id, { status: 'failed' }); resolve(); });
    p.on('close', code => {
      try {
        if (code === 0 && fs.existsSync(mp4)) {
          const od = path.join(path.dirname(webmPath), 'original');
          fs.mkdirSync(od, { recursive: true });
          fs.renameSync(webmPath, path.join(od, path.basename(webmPath)));
          updateSession(id, { file: path.basename(mp4), status: 'done' });
          catatan.catat('MP4 selesai: ' + path.basename(mp4));
        } else { catatan.error(`Ubah ke MP4 gagal (${path.basename(webmPath)}), kode FFmpeg ${code}`); updateSession(id, { status: 'failed' }); }
      } catch (e) { catatan.error(`Ubah ke MP4 gagal (${path.basename(webmPath)}): ${e.message}`); updateSession(id, { status: 'failed' }); }
      resolve();
    });
  }));
}

const recs = new Map();  // setiap rekaman punya ID sendiri, jadi dua rekaman tidak bisa tercampur
let recSeq = 0;

function closeStream(rec) {
  return new Promise(res => {
    if (!rec.stream) return res();
    if (rec.stream.destroyed || rec.stream.writableEnded) return res();
    rec.stream.end(() => res());
    rec.stream.once('error', () => res());
  });
}

// Pulihkan rekaman yang terputus (aplikasi ditutup paksa, crash, atau listrik mati saat merekam).
// Potongan rekaman sudah tertulis ke disk setiap detik, jadi isinya bisa diselamatkan.
function recoverInterrupted() {
  const list = readSessions();
  // Video kamera Sony yang belum sempat disalin: file aslinya aman di kartu SD kamera
  let sonyAda = false;
  for (const s of list) {
    if (s.kamera === 'sony' && (s.status === 'recording' || s.status === 'transfer')) {
      s.status = 'card-only'; s.recovered = true; sonyAda = true;
    }
  }
  const found = list.filter(s => s.status === 'recording');
  if (!found.length) { if (sonyAda) writeSessions(list); return 0; }
  let recovered = 0;
  for (const s of found) {
    const p = path.join(s.dir || defaultDir, s.file);
    let st = null;
    try { st = fs.statSync(p); } catch (e) {}
    if (!st || st.size < 1024) { s.status = 'lost'; continue; }   // file tidak ada / kosong
    s.recovered = true;
    s.seconds = Math.max(0, Math.round((st.mtimeMs - Date.parse(s.time)) / 1000));  // perkiraan durasi
    s.status = ffmpegPath ? 'processing' : 'webm';
    recovered++;
  }
  writeSessions(list);
  console.log(`Rekaman terputus dipulihkan: ${recovered} dari ${found.length}`);
  return recovered;
}
// Tutup rekaman yang masih terbuka dan selamatkan isinya (dipakai saat tampilan aplikasi crash)
async function rescueOpenRecordings() {
  for (const rec of [...recs.values()]) {
    recs.delete(rec.id);
    await closeStream(rec);
  }
  const n = recoverInterrupted();
  readSessions().filter(x => x.status === 'processing').forEach(x => {
    const p = path.join(x.dir || defaultDir, x.file);
    if (fs.existsSync(p)) convert(x.id, p);
  });
  return n;
}
let recoveredCount = 0;

// Saat aplikasi dibuka: pulihkan rekaman yang terputus, lalu lanjutkan konversi yang belum selesai
function mulai() {
  recoveredCount = recoverInterrupted();
  readSessions().filter(s => s.status === 'processing').forEach(s => {
    const p = path.join(s.dir || defaultDir, s.file);
    if (fs.existsSync(p)) convert(s.id, p);
  });
}
// Saat tampilan aplikasi crash: selamatkan rekaman yang sedang berjalan
async function selamatkan() { recoveredCount = await rescueOpenRecordings(); }
// Saat aplikasi ditutup: tutup semua file rekaman yang masih terbuka
function tutupSemua() { for (const rec of recs.values()) { try { if (rec.stream) rec.stream.end(); } catch (e) {} } }

// Salin video Sony dari kartu ke folder couple, lalu perbarui catatan sesi
function salinVideoSony(sid, info, file) {
  sony.unduh(info, file).then(h => {
    if (h.ok) { updateSession(sid, { status: 'done', file: path.basename(file) }); catatan.catat('Video Sony tersalin: ' + path.basename(file)); }
    else { updateSession(sid, { status: 'card-only', error: h.error }); catatan.error(`Video Sony belum tersalin (${path.basename(file)}): ${h.error} — masih aman di kartu`); }
  });
}

function daftarkan() {
  ipcMain.handle('get-sessions', () => readSessions());

  /* ---------- Aksi per sesi (halaman Riwayat sesi di Admin) ---------- */
  const cariSesi = id => readSessions().find(s => s.id === id);
  const lokasi = s => path.join(s.dir || defaultDir, s.file || '');
  ipcMain.handle('session-open', async (e, id) => {
    const s = cariSesi(id);
    if (!s || !s.file || !fs.existsSync(lokasi(s))) return { error: 'File not found in the folder.' };
    const err = await shell.openPath(lokasi(s));
    return err ? { error: err } : { ok: true };
  });
  ipcMain.handle('session-reveal', (e, id) => {
    const s = cariSesi(id);
    if (!s) return { error: 'Session not found.' };
    if (s.file && fs.existsSync(lokasi(s))) { shell.showItemInFolder(lokasi(s)); return { ok: true }; }
    if (fs.existsSync(s.dir || '')) { shell.openPath(s.dir); return { ok: true }; }
    return { error: 'Folder not found.' };
  });
  // Gambar kecil hasil photobooth untuk daftar sesi.
  // - Dibuat SATU PER SATU (antrean), tidak sekaligus, supaya aplikasi tidak tersendat.
  // - Memakai pembuat thumbnail bawaan macOS (asinkron, tidak membekukan aplikasi).
  // - Disimpan di <folder data>/thumb/<id>.jpg, jadi saat Riwayat dibuka lagi langsung tampil.
  const cacheThumb = new Map();
  const FOLDER_THUMB = path.join(require('./penyimpanan').userData, 'thumb');
  let antreanThumb = Promise.resolve();
  async function buatThumb(id) {
    const simpan = path.join(FOLDER_THUMB, `${id}.jpg`);
    try { if (fs.existsSync(simpan)) return 'data:image/jpeg;base64,' + fs.readFileSync(simpan).toString('base64'); } catch (err) {}
    const s = cariSesi(id);
    if (!s || s.label !== 'foto' || !fs.existsSync(lokasi(s))) return null;
    const { nativeImage } = require('electron');
    if (!nativeImage) return fs.statSync(lokasi(s)).size < 3e6 ? 'data:image/jpeg;base64,' + fs.readFileSync(lokasi(s)).toString('base64') : null;
    let img = null;
    try { if (nativeImage.createThumbnailFromPath) img = await nativeImage.createThumbnailFromPath(lokasi(s), { width: 240, height: 240 }); } catch (err) {}
    if (!img || img.isEmpty()) img = nativeImage.createFromPath(lokasi(s)).resize({ height: 160 });
    if (img.isEmpty()) return null;
    const jpg = img.toJPEG(80);
    try { fs.mkdirSync(FOLDER_THUMB, { recursive: true }); fs.writeFileSync(simpan, jpg); } catch (err) {}
    return 'data:image/jpeg;base64,' + jpg.toString('base64');
  }
  ipcMain.handle('session-thumb', (e, id) => {
    if (cacheThumb.has(id)) return cacheThumb.get(id);
    const hasil = antreanThumb.then(() => buatThumb(id)).catch(() => null);
    antreanThumb = hasil;
    cacheThumb.set(id, hasil);
    return hasil;
  });
  // Coba lagi: ubah ke MP4 lagi, atau salin lagi video dari kartu SD kamera Sony
  ipcMain.handle('session-retry', (e, id) => {
    const s = cariSesi(id);
    if (!s) return { error: 'Session not found.' };
    if (s.status === 'failed' || s.status === 'webm') {
      if (!ffmpegPath) return { error: 'FFmpeg is not installed, the video can\'t be converted to MP4.' };
      const webm = path.join(s.dir || defaultDir, String(s.file).replace(/\.mp4$/i, '.webm'));
      if (!fs.existsSync(webm)) return { error: 'The original recording file was not found.' };
      updateSession(id, { status: 'processing' });
      convert(id, webm);
      return { ok: true };
    }
    if (s.status === 'card-only') {
      if (!s.kartuInfo) return { error: `The video is only on the camera SD card${s.kartu ? ' (' + s.kartu + ')' : ''}. Copy it from the card manually.` };
      if (!sony.siap()) return { error: 'Connect the Sony camera first, then try again.' };
      updateSession(id, { status: 'transfer', error: undefined });
      salinVideoSony(id, s.kartuInfo, lokasi(s));
      return { ok: true };
    }
    return { error: 'This session doesn\'t need a retry.' };
  });
  ipcMain.handle('get-startup-info', () => { const r = { recovered: recoveredCount }; recoveredCount = 0; return r; });

  ipcMain.handle('rec-start', async (e, label, opsi) => {
    const pakaiSony = !!(opsi && opsi.sony);
    const name = activeCoupleName();
    let base = getOutDir(), fallback = false;
    if (!usableDir(base)) {
      base = defaultDir; fallback = true;
      console.log('Folder pilihan tidak tersedia, memakai folder default');
      if (!usableDir(base)) return { error: 'The storage folder is not writable.' };
    }
    let dir = coupleDir(base, name);
    if (!usableDir(dir)) dir = base;
    const ext = pakaiSony ? 'mp4' : 'webm';
    // Nama file: nama tamu (dari layar "Siapa namamu?"), mis. "Budi_pesan.mp4". Tanpa nama tamu: "<couple>_<waktu>_pesan".
    // Nama yang sudah dipakai (file .webm/.mp4 atau sesi yang videonya belum selesai disalin) tidak ditimpa: "Budi_2_pesan".
    const tamu = namaTamu(opsi && opsi.tamu);
    const sesiDiFolder = new Set(readSessions().filter(s => s.dir === dir).map(s => String(s.file || '').replace(/\.(webm|mp4)$/i, '')));
    const dipakai = b => { const d = tamu ? `${b}_${label}` : b; return sesiDiFolder.has(d) || ['webm', 'mp4'].some(x => fs.existsSync(path.join(dir, `${d}.${x}`))); };
    const dasar = tamu ? namaBebas(tamu, dipakai) : namaBebas(`${safeName(name) ? safeName(name) + '_' : ''}${stamp()}_${label}`, dipakai);
    const file = path.join(dir, `${tamu ? `${dasar}_${label}` : dasar}.${ext}`);

    const id = ++recSeq;
    const sid = Date.now() * 1000 + (id % 1000);
    const rec = { id, sid, file, dir, label, error: null, stream: null, t0: Date.now(), sony: pakaiSony };
    if (pakaiSony) {
      const r = await sony.rekamMulai();
      if (r.error) { catatan.error(`Rekam ${label} (Sony) tidak bisa dimulai: ${r.error}`); return { error: r.error }; }
    } else {
      try { rec.stream = fs.createWriteStream(file); }
      catch (err) { catatan.error(`Rekam ${label} tidak bisa dimulai: ${err.message}`); return { error: 'Tidak bisa membuat file rekaman: ' + err.message }; }
    }
    // Catat sesi sejak awal dengan status "recording". Kalau aplikasi atau komputer mati di tengah
    // rekaman, sesi ini dikenali dan dipulihkan saat aplikasi dibuka lagi.
    try {
      const list = readSessions();
      list.push({ id: sid, time: new Date(rec.t0).toISOString(), label, file: path.basename(file), dir,
        couple: name, ...(tamu ? { tamu: String(opsi.tamu).trim().slice(0, 40) } : {}), seconds: 0, status: 'recording', ...(pakaiSony ? { kamera: 'sony' } : {}) });
      writeSessions(list);
    } catch (err) { console.log('Gagal mencatat sesi: ' + err.message); }
    // Disk penuh / SSD tercabut: jangan crash, catat error dan beri tahu layar
    if (rec.stream) rec.stream.on('error', err => {
      if (rec.error) return;
      rec.error = err.message;
      catatan.error(`Gagal menulis rekaman ${path.basename(file)} (disk penuh / SSD tercabut?): ${err.message}`);
      const win = getWin();
      if (win) win.webContents.send('rec-error', id, err.message);
    });
    recs.set(id, rec);
    catatan.catat(`Rekam mulai: ${label}${pakaiSony ? ' (Sony)' : ''} → ${path.basename(file)}${fallback ? ' [folder cadangan]' : ''}`);
    return { id, file, fallback };
  });

  ipcMain.on('rec-chunk', (e, id, buf) => {
    const rec = recs.get(id);
    if (rec && !rec.error && rec.stream && rec.stream.writable) rec.stream.write(Buffer.from(buf));
  });


  ipcMain.handle('rec-end', async (e, id, seconds, meta) => {
    const rec = recs.get(id);
    if (!rec) return null;
    recs.delete(id);
    const sid = rec.sid;
    if (rec.sony) {
      // Hentikan rekaman di kamera. Tamu tidak perlu menunggu video disalin.
      const r = await sony.rekamStop();
      const patch = { seconds, ...(meta || {}), ...(r.error ? { status: 'card-only', error: r.error }
        : { status: 'transfer', kartu: r.nama, kartuInfo: { slot: r.slot, contentId: r.contentId, fileId: r.fileId } }) };
      updateSession(sid, patch);
      if (r.error) catatan.error(`Rekam Sony berhenti dengan error (${path.basename(rec.file)}): ${r.error}`);
      else catatan.catat(`Rekam selesai (Sony, ${seconds} dtk): ${path.basename(rec.file)}, menyalin dari kartu ${r.nama}`);
      if (!r.error) salinVideoSony(sid, r, rec.file);
      return r.error ? { ok: false, error: r.error } : { ok: true, file: rec.file };
    }
    await closeStream(rec);
    const ok = !rec.error;
    const patch = { seconds, status: !ok ? 'write-error' : (ffmpegPath ? 'processing' : 'webm'),
      ...(rec.error ? { error: rec.error } : {}), ...(meta || {}) };
    try {
      const list = readSessions();
      const s = list.find(x => x.id === sid);
      if (s) Object.assign(s, patch);
      else list.push({ id: sid, time: new Date(rec.t0).toISOString(), label: rec.label, file: path.basename(rec.file), dir: rec.dir, ...patch });
      writeSessions(list);
    } catch (err) { console.log('Gagal mencatat sesi: ' + err.message); }
    if (ok) catatan.catat(`Rekam selesai (${seconds} dtk): ${path.basename(rec.file)}`);
    else catatan.error(`Rekam gagal disimpan (${path.basename(rec.file)}): ${rec.error}`);
    if (ok) convert(sid, rec.file);
    return { ok, file: rec.file, error: rec.error };
  });

  // Batalkan rekaman yang gagal dimulai: tutup dan hapus file yang belum berisi
  ipcMain.handle('rec-abort', async (e, id) => {
    const rec = recs.get(id);
    if (!rec) return;
    recs.delete(id);
    if (rec.sony) await sony.rekamStop();
    await closeStream(rec);
    try { if (!rec.sony && fs.statSync(rec.file).size < 1024) fs.unlinkSync(rec.file); } catch (err) {}
    try { writeSessions(readSessions().filter(x => x.id !== rec.sid)); } catch (err) {}
  });
}

module.exports = { daftarkan, mulai, selamatkan, tutupSemua };
