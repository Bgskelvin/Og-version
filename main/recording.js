/* =====================================================================
   recording.js — video recording: writing the file, converting to MP4
   (FFmpeg), recording the session, and recovering interrupted recordings.
   With the Sony camera: the camera records to its SD card, then the MP4
   file is copied to the couple folder in the background (see sony-camera.js).
   Once the MP4 is ready: quiz question texts are overlaid & the phone
   version for QR is made in video-processing.js.
   ===================================================================== */
const { ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  userData,
  defaultDir,
  readSessions,
  writeSessions,
  updateSession,
  getOutDir,
  usableDir,
  safeName,
  coupleDir,
  stamp,
  guestFileName,
  freeBaseName,
} = require('./storage');
const { activeCoupleName } = require('./couple');
const { getWin } = require('./active-window');
const sony = require('./sony-camera');
const log = require('./log');
const videoProcessing = require('./video-processing');
const upload = require('./upload');
videoProcessing.useUpload(upload);

/* ---------- FFmpeg: .webm -> .mp4 ---------- */
const ffmpegPath = videoProcessing.getFfmpegPath();

function convert(id, webmPath) {
  if (!ffmpegPath) {
    updateSession(id, { status: 'webm' });
    return;
  }
  videoProcessing.enqueue(
    () =>
      new Promise(resolve => {
        const mp4 = webmPath.replace(/\.webm$/i, '.mp4');
        const p = spawn(
          ffmpegPath,
          [
            '-y',
            '-fflags',
            '+genpts',
            '-i',
            webmPath,
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '23',
            '-pix_fmt',
            'yuv420p',
            '-r',
            '30',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-movflags',
            '+faststart',
            mp4,
          ],
          { stdio: 'ignore' },
        );
        p.on('error', err => {
          log.error(`MP4 conversion failed (${path.basename(webmPath)}): ${err.message}`);
          updateSession(id, { status: 'failed' });
          resolve();
        });
        p.on('close', code => {
          try {
            if (code === 0 && fs.existsSync(mp4)) {
              const od = path.join(path.dirname(webmPath), 'original');
              fs.mkdirSync(od, { recursive: true });
              fs.renameSync(webmPath, path.join(od, path.basename(webmPath)));
              updateSession(id, { file: path.basename(mp4), status: 'done' });
              log.write('MP4 done: ' + path.basename(mp4));
              videoProcessing.processLater(id); // quiz question texts & phone version for QR
            } else {
              log.error(`MP4 conversion failed (${path.basename(webmPath)}), FFmpeg code ${code}`);
              updateSession(id, { status: 'failed' });
            }
          } catch (e) {
            log.error(`MP4 conversion failed (${path.basename(webmPath)}): ${e.message}`);
            updateSession(id, { status: 'failed' });
          }
          resolve();
        });
      }),
  );
}
// Video download by QR: the code & link exist right away, the video follows after processing & upload
function reserveQr(sid, label, couple) {
  if (!videoProcessing.available() || !upload.videoEnabled()) return null;
  return upload.queueVideo(sid, { couple, label });
}

// The label ('message' | 'quiz') is also the end of the file name. Message videos keep the
// file names they always had ("Budi_pesan.mp4"), so the couple's folder looks the same as before.
const FILE_LABELS = { message: 'pesan' };
const fileLabel = label => FILE_LABELS[label] || label;

const recs = new Map(); // every recording has its own ID, so two recordings can never get mixed up
let recSeq = 0;

function closeStream(rec) {
  return new Promise(res => {
    if (!rec.stream) return res();
    if (rec.stream.destroyed || rec.stream.writableEnded) return res();
    rec.stream.end(() => res());
    rec.stream.once('error', () => res());
  });
}

// Recover interrupted recordings (app force-quit, crash, or power cut while recording).
// Recording chunks are written to disk every second, so their content can be saved.
function recoverInterrupted() {
  const list = readSessions();
  // Sony camera videos not copied yet: the original file is safe on the camera's SD card
  let sonyFound = false;
  for (const s of list) {
    if (s.camera === 'sony' && (s.status === 'recording' || s.status === 'transfer')) {
      s.status = 'card-only';
      s.recovered = true;
      sonyFound = true;
    }
  }
  const found = list.filter(s => s.status === 'recording');
  if (!found.length) {
    if (sonyFound) writeSessions(list);
    return 0;
  }
  let recovered = 0;
  for (const s of found) {
    const p = path.join(s.dir || defaultDir, s.file);
    let st = null;
    try {
      st = fs.statSync(p);
    } catch {
      /* the recording file doesn't exist yet */
    }
    if (!st || st.size < 1024) {
      s.status = 'lost';
      continue;
    } // file missing / empty
    s.recovered = true;
    s.seconds = Math.max(0, Math.round((st.mtimeMs - Date.parse(s.time)) / 1000)); // estimated length
    s.status = ffmpegPath ? 'processing' : 'webm';
    recovered++;
  }
  writeSessions(list);
  console.log(`Interrupted recordings recovered: ${recovered} of ${found.length}`);
  return recovered;
}
// Close recordings that are still open and save their content (used when the app UI crashes)
async function rescueOpenRecordings() {
  for (const rec of [...recs.values()]) {
    recs.delete(rec.id);
    await closeStream(rec);
  }
  const n = recoverInterrupted();
  readSessions()
    .filter(x => x.status === 'processing')
    .forEach(x => {
      const p = path.join(x.dir || defaultDir, x.file);
      if (fs.existsSync(p)) convert(x.id, p);
    });
  return n;
}
let recoveredCount = 0;

// When the app opens: recover interrupted recordings, then continue unfinished conversions
function start() {
  recoveredCount = recoverInterrupted();
  readSessions()
    .filter(s => s.status === 'processing')
    .forEach(s => {
      const p = path.join(s.dir || defaultDir, s.file);
      if (fs.existsSync(p)) convert(s.id, p);
    });
  videoProcessing.start(); // quiz texts / phone versions not finished yet
}
// When the app UI crashes: save the recordings in progress
async function rescue() {
  recoveredCount = await rescueOpenRecordings();
}
// When the app closes: close every recording file that is still open
function closeAll() {
  for (const rec of recs.values()) {
    try {
      if (rec.stream) rec.stream.end();
    } catch {
      /* the stream is already closed */
    }
  }
}

// Copy a Sony video from the card to the couple folder, then update the session
function copySonyVideo(sid, info, file) {
  sony.download(info, file).then(h => {
    if (h.ok) {
      updateSession(sid, { status: 'done', file: path.basename(file) });
      log.write('Sony video copied: ' + path.basename(file));
      videoProcessing.processLater(sid);
    } else {
      updateSession(sid, { status: 'card-only', error: h.error });
      log.error(`Sony video not copied yet (${path.basename(file)}): ${h.error} — still safe on the card`);
    }
  });
}

function register() {
  ipcMain.handle('get-sessions', () => readSessions());

  /* ---------- Per-session actions (Session history page in Admin) ---------- */
  const findSession = id => readSessions().find(s => s.id === id);
  const location = s => path.join(s.dir || defaultDir, s.file || '');
  ipcMain.handle('session-open', async (e, id) => {
    const s = findSession(id);
    if (!s || !s.file || !fs.existsSync(location(s))) return { error: 'File not found in the folder.' };
    const err = await shell.openPath(location(s));
    return err ? { error: err } : { ok: true };
  });
  ipcMain.handle('session-reveal', (e, id) => {
    const s = findSession(id);
    if (!s) return { error: 'Session not found.' };
    if (s.file && fs.existsSync(location(s))) {
      shell.showItemInFolder(location(s));
      return { ok: true };
    }
    if (fs.existsSync(s.dir || '')) {
      shell.openPath(s.dir);
      return { ok: true };
    }
    return { error: 'Folder not found.' };
  });
  // Small images of photobooth results for the session list.
  // - Made ONE AT A TIME (queue), not all at once, so the app doesn't stutter.
  // - Uses the built-in macOS thumbnail maker (asynchronous, doesn't freeze the app).
  // - Saved in <data folder>/thumb/<id>.jpg, so they show right away when History opens again.
  const thumbCache = new Map();
  const THUMB_DIR = path.join(userData, 'thumb');
  let thumbQueue = Promise.resolve();
  async function makeThumb(id) {
    const saved = path.join(THUMB_DIR, `${id}.jpg`);
    try {
      if (fs.existsSync(saved)) return 'data:image/jpeg;base64,' + fs.readFileSync(saved).toString('base64');
    } catch {
      /* the saved small image is damaged: made again below */
    }
    const s = findSession(id);
    if (!s || s.label !== 'photo' || !fs.existsSync(location(s))) return null;
    const { nativeImage } = require('electron');
    if (!nativeImage)
      return fs.statSync(location(s)).size < 3e6
        ? 'data:image/jpeg;base64,' + fs.readFileSync(location(s)).toString('base64')
        : null;
    let img = null;
    try {
      if (nativeImage.createThumbnailFromPath)
        img = await nativeImage.createThumbnailFromPath(location(s), { width: 240, height: 240 });
    } catch {
      /* macOS can't make a small image: resized from the full image below */
    }
    if (!img || img.isEmpty()) img = nativeImage.createFromPath(location(s)).resize({ height: 160 });
    if (img.isEmpty()) return null;
    const jpg = img.toJPEG(80);
    try {
      fs.mkdirSync(THUMB_DIR, { recursive: true });
      fs.writeFileSync(saved, jpg);
    } catch {
      /* the small image is only saved to be faster; it still shows if saving fails */
    }
    return 'data:image/jpeg;base64,' + jpg.toString('base64');
  }
  ipcMain.handle('session-thumb', (e, id) => {
    if (thumbCache.has(id)) return thumbCache.get(id);
    const result = thumbQueue.then(() => makeThumb(id)).catch(() => null);
    thumbQueue = result;
    thumbCache.set(id, result);
    return result;
  });
  // Retry: convert to MP4 again, or copy the video from the Sony camera's SD card again
  ipcMain.handle('session-retry', (e, id) => {
    const s = findSession(id);
    if (!s) return { error: 'Session not found.' };
    if (s.status === 'failed' || s.status === 'webm') {
      if (!ffmpegPath) return { error: "FFmpeg is not installed, the video can't be converted to MP4." };
      const webm = path.join(s.dir || defaultDir, String(s.file).replace(/\.mp4$/i, '.webm'));
      if (!fs.existsSync(webm)) return { error: 'The original recording file was not found.' };
      updateSession(id, { status: 'processing' });
      convert(id, webm);
      return { ok: true };
    }
    if (s.status === 'card-only') {
      if (!s.cardInfo)
        return {
          error: `The video is only on the camera SD card${s.cardFile ? ' (' + s.cardFile + ')' : ''}. Copy it from the card manually.`,
        };
      if (!sony.ready()) return { error: 'Connect the Sony camera first, then try again.' };
      updateSession(id, { status: 'transfer', error: undefined });
      copySonyVideo(id, s.cardInfo, location(s));
      return { ok: true };
    }
    // Question texts / phone version for QR that failed: make them again
    if (s.status === 'done' && (s.captionStatus === 'failed' || s.upload === 'failed')) {
      if (!ffmpegPath) return { error: "FFmpeg is not installed, the video can't be processed." };
      const patch = {};
      if (s.captionStatus === 'failed') patch.captionStatus = undefined;
      if (s.upload === 'failed') {
        if (!upload.videoEnabled()) return { error: 'Turn on "QR for video" in Admin first.' };
        patch.upload = 'processing';
        upload.requeueVideo(s);
      }
      updateSession(id, patch);
      videoProcessing.processLater(id);
      return { ok: true };
    }
    return { error: "This session doesn't need a retry." };
  });
  ipcMain.handle('get-startup-info', () => {
    const r = { recovered: recoveredCount };
    recoveredCount = 0;
    return r;
  });

  ipcMain.handle('rec-start', async (e, label, options) => {
    const useSony = !!(options && options.sony);
    const full = require('./disk-space').refuseIfFull();
    if (full) {
      log.warn('Recording refused: ' + full);
      return { error: full };
    }
    const name = activeCoupleName();
    let base = getOutDir(),
      fallback = false;
    if (!usableDir(base)) {
      base = defaultDir;
      fallback = true;
      console.log('Chosen folder not available, using the default folder');
      if (!usableDir(base)) return { error: 'The storage folder is not writable.' };
    }
    let dir = coupleDir(base, name);
    if (!usableDir(dir)) dir = base;
    const ext = useSony ? 'mp4' : 'webm';
    // File name: the guest's name (from the "What's your name?" screen), e.g. "Budi_pesan.mp4". No guest name: "<couple>_<time>_pesan".
    // Names already in use (.webm/.mp4 files or sessions whose video isn't copied yet) are not overwritten: "Budi_2_pesan".
    const guest = guestFileName(options && options.guest);
    const sessionsInFolder = new Set(
      readSessions()
        .filter(s => s.dir === dir)
        .map(s => String(s.file || '').replace(/\.(webm|mp4)$/i, '')),
    );
    const isTaken = b => {
      const d = guest ? `${b}_${fileLabel(label)}` : b;
      return sessionsInFolder.has(d) || ['webm', 'mp4'].some(x => fs.existsSync(path.join(dir, `${d}.${x}`)));
    };
    const baseName = guest
      ? freeBaseName(guest, isTaken)
      : freeBaseName(`${safeName(name) ? safeName(name) + '_' : ''}${stamp()}_${fileLabel(label)}`, isTaken);
    const file = path.join(dir, `${guest ? `${baseName}_${fileLabel(label)}` : baseName}.${ext}`);

    const id = ++recSeq;
    const sid = Date.now() * 1000 + (id % 1000);
    const rec = { id, sid, file, dir, label, error: null, stream: null, t0: Date.now(), sony: useSony };
    if (useSony) {
      const r = await sony.startRecording();
      if (r.error) {
        log.error(`Recording ${label} (Sony) could not start: ${r.error}`);
        return { error: r.error };
      }
    } else {
      try {
        rec.stream = fs.createWriteStream(file);
      } catch (err) {
        log.error(`Recording ${label} could not start: ${err.message}`);
        return { error: 'Could not create the recording file: ' + err.message };
      }
    }
    // Record the session from the start with status "recording". If the app or computer dies in the
    // middle of a recording, this session is recognized and recovered when the app opens again.
    try {
      const list = readSessions();
      list.push({
        id: sid,
        time: new Date(rec.t0).toISOString(),
        label,
        file: path.basename(file),
        dir,
        couple: name,
        ...(guest ? { guest: String(options.guest).trim().slice(0, 40) } : {}),
        seconds: 0,
        status: 'recording',
        ...(useSony ? { camera: 'sony' } : {}),
      });
      writeSessions(list);
    } catch (err) {
      console.log('Could not record the session: ' + err.message);
    }
    // Disk full / SSD unplugged: don't crash, log the error and tell the screen
    if (rec.stream)
      rec.stream.on('error', err => {
        if (rec.error) return;
        rec.error = err.message;
        log.error(`Could not write recording ${path.basename(file)} (disk full / SSD unplugged?): ${err.message}`);
        const win = getWin();
        if (win) win.webContents.send('rec-error', id, err.message);
      });
    recs.set(id, rec);
    log.write(
      `Recording started: ${label}${useSony ? ' (Sony)' : ''} → ${path.basename(file)}${fallback ? ' [fallback folder]' : ''}`,
    );
    return { id, file, fallback };
  });

  ipcMain.on('rec-chunk', (e, id, buf) => {
    const rec = recs.get(id);
    if (rec && !rec.error && rec.stream && rec.stream.writable) rec.stream.write(Buffer.from(buf));
  });

  ipcMain.handle('rec-end', async (e, id, seconds, incomingMeta) => {
    const rec = recs.get(id);
    if (!rec) return null;
    recs.delete(id);
    const sid = rec.sid;
    // Quiz: time & text image of each question (the images are saved as files, not in sessions.json)
    const { captions, captionImages, ...meta } = incomingMeta || {};
    const cleanCaptions = !meta.aborted ? videoProcessing.saveCaptions(sid, captions, captionImages) : null;
    if (cleanCaptions) meta.captions = cleanCaptions;
    if (rec.sony) {
      // Stop recording on the camera. The guest doesn't have to wait for the video to be copied.
      const r = await sony.stopRecording();
      const qr = !r.error && !meta.aborted ? reserveQr(sid, rec.label, meta.couple) : null;
      const patch = {
        seconds,
        ...meta,
        ...(qr ? { code: qr.code, link: qr.link, upload: 'processing' } : {}),
        ...(r.error
          ? { status: 'card-only', error: r.error }
          : {
              status: 'transfer',
              cardFile: r.cardFile,
              cardInfo: { slot: r.slot, contentId: r.contentId, fileId: r.fileId },
            }),
      };
      updateSession(sid, patch);
      if (r.error) log.error(`Sony recording stopped with an error (${path.basename(rec.file)}): ${r.error}`);
      else
        log.write(
          `Recording done (Sony, ${seconds} s): ${path.basename(rec.file)}, copying from card ${r.cardFile}${qr ? ', QR ' + qr.code : ''}`,
        );
      if (!r.error) copySonyVideo(sid, r, rec.file);
      return r.error ? { ok: false, error: r.error } : { ok: true, file: rec.file, link: qr ? qr.link : null };
    }
    await closeStream(rec);
    const ok = !rec.error;
    const qr = ok && ffmpegPath && !meta.aborted ? reserveQr(sid, rec.label, meta.couple) : null;
    const patch = {
      seconds,
      status: !ok ? 'write-error' : ffmpegPath ? 'processing' : 'webm',
      ...(rec.error ? { error: rec.error } : {}),
      ...meta,
      ...(qr ? { code: qr.code, link: qr.link, upload: 'processing' } : {}),
    };
    try {
      const list = readSessions();
      const s = list.find(x => x.id === sid);
      if (s) Object.assign(s, patch);
      else
        list.push({
          id: sid,
          time: new Date(rec.t0).toISOString(),
          label: rec.label,
          file: path.basename(rec.file),
          dir: rec.dir,
          ...patch,
        });
      writeSessions(list);
    } catch (err) {
      console.log('Could not record the session: ' + err.message);
    }
    if (ok) log.write(`Recording done (${seconds} s): ${path.basename(rec.file)}${qr ? ', QR ' + qr.code : ''}`);
    else log.error(`Recording could not be saved (${path.basename(rec.file)}): ${rec.error}`);
    if (ok) convert(sid, rec.file);
    return { ok, file: rec.file, error: rec.error, link: qr ? qr.link : null };
  });

  // Cancel a recording that failed to start: close it and delete the still-empty file
  ipcMain.handle('rec-abort', async (e, id) => {
    const rec = recs.get(id);
    if (!rec) return;
    recs.delete(id);
    if (rec.sony) await sony.stopRecording();
    await closeStream(rec);
    try {
      if (!rec.sony && fs.statSync(rec.file).size < 1024) fs.unlinkSync(rec.file);
    } catch (e) {
      log.warn('The cancelled recording could not be deleted: ' + e.message);
    }
    try {
      writeSessions(readSessions().filter(x => x.id !== rec.sid));
    } catch (e) {
      log.warn('The cancelled session could not be removed from the list: ' + e.message);
    }
  });
}

module.exports = { register, start, rescue, closeAll };
