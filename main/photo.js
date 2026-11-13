/* =====================================================================
   photo.js — saving Photo Booth results (4 original photos + 1 edited result)
   ===================================================================== */
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('./log');
const {
  defaultDir,
  saveSession,
  getOutDir,
  usableDir,
  safeName,
  coupleDir,
  stamp,
  guestFileName,
  freeBaseName,
} = require('./storage');
const { activeCoupleName } = require('./couple');
const upload = require('./upload');

function register() {
  // ---------- Photo Booth: save 4 original photos + 1 edited result ----------
  // Location: <storage folder>/<couple name>/Foto/
  ipcMain.handle('save-photos', async (e, payload) => {
    try {
      const { originals = [], result, singles: singles = [], meta = {}, guest: rawGuest } = payload || {};
      if (!result || !originals.length) {
        log.error('Save photos refused: no photo data');
        return { ok: false, error: 'No photo data' };
      }
      const full = require('./disk-space').refuseIfFull();
      if (full) {
        log.error('Save photos refused: ' + full);
        return { ok: false, error: full };
      }
      const name = activeCoupleName();
      let base = getOutDir();
      if (!usableDir(base)) {
        base = defaultDir;
        if (!usableDir(base)) return { ok: false, error: 'The storage folder is not writable.' };
      }
      const dir = path.join(coupleDir(base, name), 'Foto');
      if (!usableDir(dir)) return { ok: false, error: 'Could not create the photo folder.' };
      // File names: the guest's name, e.g. "Budi_hasil.jpg" + "Budi_foto-1.jpg"…; no guest name: "<couple>_<time>_hasil.jpg".
      // Names already in use are not overwritten: "Budi_2_hasil.jpg".
      const guest = guestFileName(rawGuest);
      const baseName = guest || (safeName(name) ? safeName(name) + '_' : '') + stamp();
      const prefix = freeBaseName(
        baseName,
        b => fs.existsSync(path.join(dir, `${b}_hasil.jpg`)) || fs.existsSync(path.join(dir, `${b}_foto-1.jpg`)),
      );
      const files = [];
      for (let i = 0; i < originals.length; i++) {
        const f = `${prefix}_foto-${i + 1}.jpg`;
        await fs.promises.writeFile(path.join(dir, f), Buffer.from(originals[i]));
        files.push(f);
      }
      const resultFile = `${prefix}_hasil.jpg`;
      await fs.promises.writeFile(path.join(dir, resultFile), Buffer.from(result));
      // Download by QR (if turned on in Admin): the code & link exist right away, the upload follows in the background
      const sid = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      let qr = null;
      try {
        // Single photos (without template) are uploaded too so guests can download them as well
        const singleFiles = upload.ready() ? await upload.saveSinglePhotos(sid, singles) : [];
        qr = upload.queuePhoto(path.join(dir, resultFile), sid, { singles: singleFiles, couple: name });
        saveSession({
          id: sid,
          time: new Date().toISOString(),
          label: 'photo',
          file: resultFile,
          dir,
          couple: name,
          ...(guest ? { guest: String(rawGuest).trim().slice(0, 40) } : {}),
          seconds: 0,
          status: 'photo',
          photos: originals.length,
          originalFiles: files,
          ...(qr ? { code: qr.code, link: qr.link, upload: 'queued' } : {}),
          ...meta,
        });
      } catch (err) {
        console.log('Could not record the photo session: ' + err.message);
      }
      log.write(`Photos saved: ${resultFile} (+${originals.length} originals)${qr ? ', QR ' + qr.code : ''}`);
      return { ok: true, file: path.join(dir, resultFile), link: qr ? qr.link : null };
    } catch (err) {
      log.error('Could not save the photos: ' + err.message);
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { register };
