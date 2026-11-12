/* =====================================================================
   upload.js — photo download by QR: code, link, and the upload queue.
   - Every photobooth session gets a random code; the link & QR exist right
     away, even while the internet is down.
   - Result photos go into a queue saved on disk (antrean-unggah.json),
     uploaded one at a time to the Cloudflare server (cloud/worker.mjs), and
     retried automatically on failure — also after the app is opened again.
   - Single photos (1-4, without template) are uploaded AFTER every result photo
     has been sent, so each QR opens quickly. Kept temporarily in
     <data folder>/qr-satuan/ and deleted after sending.
   - Video (message & quiz): the code & link exist as soon as the recording ends;
     the "phone version" is made by video-processing.js, then uploaded IN 8 MB
     PARTS (can resume if the internet drops). Photos always go first:
     new photos are sent between the video parts.
   Queue item fields, the settings (settings.unggah) and the server protocol
   (cloud/worker.mjs) keep their names; the status fields are shared with the UI.
   ===================================================================== */
const { ipcMain, shell, clipboard } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { userData, readJSON, writeJSON, readSettings, writeSettings, updateSession } = require('./storage');
const { getWin } = require('./active-window');
const log = require('./log');

const QUEUE_FILE = path.join(userData, 'antrean-unggah.json');
const SINGLES_DIR = path.join(userData, 'qr-satuan');
const MAX_SINGLES = 4;
// Size of each video part (R2: all parts the same size, except the last). LEURA_TEST_PART_SIZE is only for the automated tests.
const PART_SIZE = Number(process.env.LEURA_TEST_PART_SIZE) || 8 * 1024 * 1024;
const SETUP_RESULT = path.join(__dirname, '..', 'cloud', '.hasil-pasang.json');
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // without look-alike letters (0/O, 1/l/I)
const MISSING = 'MISSING'; // returned by the senders when the file to send is gone

let queue = [],
  loaded = false;
let running = false,
  timer = null;
const st = { sent: 0, sentVideos: 0, lastError: '', current: null, progress: null };

const settings = () => {
  const u = readSettings().unggah || {};
  return {
    aktif: !!u.aktif,
    url: u.url || '',
    kunci: u.kunci || '',
    video: u.video !== false,
    videoKualitas: u.videoKualitas === '1080' ? '1080' : '720',
  };
};
const ready = () => {
  const p = settings();
  return p.aktif && !!p.url && !!p.kunci;
};
const videoEnabled = () => ready() && settings().video;
const videoQuality = () => settings().videoKualitas;
const baseUrl = url =>
  String(url || '')
    .trim()
    .replace(/\/+$/, '');
const newCode = () => Array.from({ length: 10 }, () => LETTERS[crypto.randomInt(LETTERS.length)]).join('');
const photoLink = code => baseUrl(settings().url) + '/f/' + code;
const videoLink = code => baseUrl(settings().url) + '/v/' + code;
const isVideo = x => x.jenis === 'video';

// The queue is read from disk once (also if video-processing.js hands over a video before start() is called)
function load() {
  if (loaded) return;
  loaded = true;
  queue = readJSON(QUEUE_FILE, []);
  if (!Array.isArray(queue)) queue = [];
}
function saveQueue() {
  try {
    writeJSON(QUEUE_FILE, queue);
  } catch (e) {
    console.log('Could not save the upload queue: ' + e.message);
  }
}
function status() {
  load();
  const p = settings();
  return {
    aktif: p.aktif,
    url: p.url,
    adaKunci: !!p.kunci,
    video: p.video,
    videoKualitas: p.videoKualitas,
    menunggu: queue.filter(x => !isVideo(x) && !x.hasilTerkirim).length,
    menungguSatuan: queue.reduce((n, x) => n + singlesLeft(x).length, 0),
    menungguVideo: queue.filter(isVideo).length,
    videoDiolah: queue.filter(x => isVideo(x) && !x.file).length,
    terkirim: st.sent,
    terkirimVideo: st.sentVideos,
    errorTerakhir: st.lastError,
    sedang: st.current,
    progres: st.progress,
    adaHasilPasang: fs.existsSync(SETUP_RESULT),
  };
}
function broadcast() {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('unggah-status', status());
}

// Save single photos temporarily (for upload). Returns: list of file paths.
async function saveSinglePhotos(sid, singles) {
  const out = [];
  if (!Array.isArray(singles)) return out;
  try {
    for (const [i, b] of singles.slice(0, MAX_SINGLES).entries()) {
      const u = b instanceof Uint8Array ? b : new Uint8Array(b || []);
      if (u.length < 4 || u.length > 15 * 1024 * 1024 || u[0] !== 0xff || u[1] !== 0xd8) continue;
      fs.mkdirSync(SINGLES_DIR, { recursive: true });
      const f = path.join(SINGLES_DIR, `${sid}-${i + 1}.jpg`);
      await fs.promises.writeFile(f, Buffer.from(u));
      out.push(f);
    }
  } catch (e) {
    log.warn('Single photos for QR could not be saved: ' + e.message);
  }
  return out;
}
const removeFile = f => {
  try {
    fs.unlinkSync(f);
  } catch {
    /* the file is already deleted */
  }
};
const singlesLeft = item =>
  (item.satuan || []).map((f, i) => i + 1).filter(n => !(item.satuanTerkirim || []).includes(n));

// An old server (from before single photos / video) doesn't know the new features — single photos would even
// OVERWRITE the result photo. So ask once first: a new server answers /ping with satuan: true, video: true.
let serverFeatures = null;
async function serverSupports(p, feature) {
  if (serverFeatures === null) {
    try {
      const r = await fetch(`${baseUrl(p.url)}/ping`, {
        headers: { authorization: 'Bearer ' + p.kunci },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return null; // unknown yet (internet?) — try again later
      const j = await r.json();
      serverFeatures = { satuan: !!j.satuan, video: !!j.video };
      if (!serverFeatures.satuan)
        log.warn('Old QR server: single photos are not uploaded. Run "npm run cloud:pasang" to update the server.');
      if (!serverFeatures.video)
        log.warn('Old QR server: videos cannot be uploaded. Run "npm run cloud:pasang" to update the server.');
    } catch {
      return null;
    }
  }
  return serverFeatures[feature];
}

// Send one photo (n = 0: result photo, 1-4: single photo). Returns '' on success, or an error text.
async function sendPhoto(item, p, n = 0) {
  let data;
  try {
    data = fs.readFileSync(n ? item.satuan[n - 1] : item.file);
  } catch {
    return MISSING;
  }
  const ctrl = new AbortController();
  const limit = setTimeout(() => ctrl.abort(), 60000);
  const headers = { authorization: 'Bearer ' + p.kunci, 'content-type': 'image/jpeg' };
  if (!n) {
    headers['x-leura-jumlah'] = String((item.satuan || []).length);
    if (item.couple) headers['x-leura-couple'] = encodeURIComponent(item.couple);
  }
  try {
    const r = await fetch(`${baseUrl(p.url)}/u/${item.kode}${n ? '/' + n : ''}`, {
      method: 'PUT',
      body: data,
      signal: ctrl.signal,
      headers,
    });
    if (r.ok) return '';
    let message = '';
    try {
      message = (await r.json()).error || '';
    } catch {
      /* the server didn't send JSON: the status code is enough */
    }
    return `Server refused (${r.status}${message ? ': ' + message : ''})`;
  } catch (e) {
    return e.name === 'AbortError' ? 'Upload took too long (slow internet?)' : 'No internet / server unreachable';
  } finally {
    clearTimeout(limit);
  }
}

// Done with one item: take it out of the queue & delete its temporary files (single photos / phone version of the video)
function finishItem(item) {
  queue = queue.filter(x => x !== item);
  (item.satuan || []).forEach(removeFile);
  if (isVideo(item)) {
    if (item.file) removeFile(item.file);
    if (item.poster) removeFile(item.poster);
  }
}

// Send ONE video step: cover → start → part n → finish. Returns '' on success, or an error text.
async function request(p, route, options = {}, limitMs = 120000) {
  const ctrl = new AbortController();
  const limit = setTimeout(() => ctrl.abort(), limitMs);
  try {
    const r = await fetch(`${baseUrl(p.url)}${route}`, {
      ...options,
      signal: ctrl.signal,
      headers: { authorization: 'Bearer ' + p.kunci, ...(options.headers || {}) },
    });
    let j = {};
    try {
      j = await r.json();
    } catch {
      /* the server didn't send JSON: checked from the status code */
    }
    return { r, j };
  } catch (e) {
    return {
      fault: e.name === 'AbortError' ? 'Upload took too long (slow internet?)' : 'No internet / server unreachable',
    };
  } finally {
    clearTimeout(limit);
  }
}
const refused = (r, j) => `Server refused (${r.status}${j && j.error ? ': ' + j.error : ''})`;
async function sendVideo(item, p) {
  let size;
  try {
    size = fs.statSync(item.file).size;
  } catch {
    return MISSING;
  }
  const total = Math.max(1, Math.ceil(size / PART_SIZE));
  const base = `/uv/${item.kode}`;
  if (!item.posterTerkirim && item.poster) {
    let data;
    try {
      data = fs.readFileSync(item.poster);
    } catch {
      item.posterTerkirim = true;
      return '';
    }
    const { r, j, fault } = await request(
      p,
      base + '/poster',
      { method: 'PUT', body: data, headers: { 'content-type': 'image/jpeg' } },
      60000,
    );
    if (fault) return fault;
    if (!r.ok) return refused(r, j);
    item.posterTerkirim = true;
    return '';
  }
  if (!item.uploadId) {
    const headers = { 'x-leura-jenis': item.label === 'quiz' ? 'quiz' : 'pesan', 'x-leura-ukuran': String(size) };
    if (item.couple) headers['x-leura-couple'] = encodeURIComponent(item.couple);
    const { r, j, fault } = await request(p, base + '/mulai', { method: 'POST', headers }, 60000);
    if (fault) return fault;
    if (!r.ok) return refused(r, j);
    if (j.ada) {
      item.terkirim = true;
      return '';
    } // already arrived earlier (e.g. the app was closed while finishing)
    item.uploadId = j.uploadId;
    item.bagian = [];
    return '';
  }
  const q = '?u=' + encodeURIComponent(item.uploadId);
  if (item.bagian.length < total) {
    const n = item.bagian.length + 1;
    const buf = Buffer.alloc(Math.min(PART_SIZE, size - (n - 1) * PART_SIZE));
    try {
      const fd = fs.openSync(item.file, 'r');
      fs.readSync(fd, buf, 0, buf.length, (n - 1) * PART_SIZE);
      fs.closeSync(fd);
    } catch {
      return MISSING;
    }
    st.progress = { kode: item.kode, n, total };
    const { r, j, fault } = await request(p, `${base}/${n}${q}`, {
      method: 'PUT',
      body: buf,
      headers: { 'content-type': 'application/octet-stream' },
    });
    if (fault) return fault;
    if (r.status === 404 && j.error === 'upload-hilang') {
      item.uploadId = null;
      item.bagian = [];
      return 'Upload expired on the server, starting again';
    }
    if (!r.ok || !j.etag) return refused(r, j);
    item.bagian.push({ partNumber: n, etag: j.etag });
    return '';
  }
  const { r, j, fault } = await request(p, `${base}/selesai${q}`, {
    method: 'POST',
    body: JSON.stringify({ bagian: item.bagian }),
    headers: { 'content-type': 'application/json' },
  });
  if (fault) return fault;
  if (r.status === 404 && j.error === 'upload-hilang') {
    item.uploadId = null;
    item.bagian = [];
    return 'Upload expired on the server, starting again';
  }
  if (!r.ok) return refused(r, j);
  item.terkirim = true;
  return '';
}

// Run the queue: one at a time; failures are retried with a growing pause (max 1 minute).
// Order: every result photo first (so QRs open quickly), then the single photos.
async function runQueue() {
  load();
  clearTimeout(timer);
  if (running) return;
  running = true;
  try {
    while (queue.length && ready()) {
      const now = Date.now(),
        due = x => (x.berikut || 0) <= now;
      const photos = queue.filter(x => !isVideo(x));
      let item = photos.find(x => !x.hasilTerkirim && due(x)),
        n = 0;
      if (!item && !photos.some(x => !x.hasilTerkirim)) {
        item = photos.find(x => due(x) && singlesLeft(x).length);
        if (item) {
          const supported = await serverSupports(settings(), 'satuan');
          if (supported === false) {
            photos.filter(x => x.hasilTerkirim).forEach(finishItem);
            saveQueue();
            broadcast();
            continue;
          }
          if (supported === null) {
            item.berikut = Date.now() + 15000;
            saveQueue();
            continue;
          }
          n = singlesLeft(item)[0];
        }
      }
      // Video: after every photo (result & single) has been sent, one part per round
      if (!item && !photos.some(x => !x.hasilTerkirim || singlesLeft(x).length)) {
        const video = queue.find(x => isVideo(x) && x.file && due(x));
        if (video) {
          const supported = await serverSupports(settings(), 'video');
          if (supported === false) {
            queue.filter(isVideo).forEach(x => {
              if (x.sid) updateSession(x.sid, { unggah: 'server-lama' });
              finishItem(x);
            });
            saveQueue();
            broadcast();
            continue;
          }
          if (supported === null) {
            video.berikut = Date.now() + 15000;
            saveQueue();
            continue;
          }
          st.current = video.kode;
          broadcast();
          const err = await sendVideo(video, settings());
          st.current = null;
          if (err === MISSING) {
            log.error(`QR ${video.kode}: video file missing, cannot be sent`);
            if (video.sid) updateSession(video.sid, { unggah: 'hilang' });
            finishItem(video);
            st.progress = null;
          } else if (!err) {
            video.coba = 0;
            st.lastError = '';
            if (video.terkirim) {
              log.write(`QR ${video.kode}: video sent (${video.bagian ? video.bagian.length : 0} parts)`);
              if (video.sid) updateSession(video.sid, { unggah: 'terkirim' });
              finishItem(video);
              st.sentVideos++;
              st.progress = null;
            }
          } else {
            video.coba = (video.coba || 0) + 1;
            if (err !== st.lastError)
              log.warn(`QR ${video.kode}: video not sent yet — ${err} (retrying automatically)`);
            video.berikut = Date.now() + Math.min(60000, 3000 * 2 ** Math.min(video.coba, 5));
            st.lastError = err;
            if (video.sid) updateSession(video.sid, { unggah: 'menunggu' });
          }
          saveQueue();
          broadcast();
          continue;
        }
      }
      if (!item) break;
      st.current = item.kode;
      broadcast();
      const err = await sendPhoto(item, settings(), n);
      st.current = null;
      if (n && (!err || err === MISSING)) {
        // single photo
        item.satuanTerkirim = [...(item.satuanTerkirim || []), n];
        if (err) log.warn(`QR ${item.kode}: single photo ${n} missing, skipped`);
        item.coba = 0;
        st.lastError = err ? st.lastError : '';
        if (!singlesLeft(item).length) {
          finishItem(item);
          log.write(`QR ${item.kode}: ${item.satuan.length} single photos sent`);
        }
      } else if (!err || err === MISSING) {
        // result photo
        if (err) log.error(`QR ${item.kode}: photo file missing, cannot be sent (${path.basename(item.file)})`);
        else log.write(`QR ${item.kode}: photo sent${item.coba ? ` (after ${item.coba} failed attempt(s))` : ''}`);
        item.hasilTerkirim = true;
        item.coba = 0;
        if (err || !singlesLeft(item).length) finishItem(item);
        if (item.sid) updateSession(item.sid, { unggah: err ? 'hilang' : 'terkirim' });
        if (!err) {
          st.sent++;
          st.lastError = '';
        }
      } else {
        item.coba = (item.coba || 0) + 1;
        if (err !== st.lastError)
          log.warn(
            `QR ${item.kode}: ${n ? 'single photo ' + n + ' ' : ''}not sent yet — ${err} (retrying automatically)`,
          );
        item.berikut = Date.now() + Math.min(60000, 3000 * 2 ** Math.min(item.coba, 5));
        st.lastError = err;
        if (item.sid && !n) updateSession(item.sid, { unggah: 'menunggu' });
      }
      saveQueue();
      broadcast();
    }
  } finally {
    running = false;
    const sendable = queue.filter(x => !isVideo(x) || x.file); // videos still being processed can't be sent yet
    if (sendable.length && ready()) {
      const wait = Math.max(500, Math.min(...sendable.map(x => (x.berikut || 0) - Date.now())));
      timer = setTimeout(runQueue, wait);
    }
  }
}

// Called when a photobooth photo is saved. Returns { kode, link } or null when QR is off.
// options.satuan: single photo files (from saveSinglePhotos); options.couple: couple name for the download page
function queuePhoto(file, sid, options = {}) {
  if (!ready()) {
    (options.satuan || []).forEach(removeFile);
    return null;
  }
  load();
  const code = newCode();
  queue.push({
    kode: code,
    file,
    sid,
    satuan: (options.satuan || []).slice(0, MAX_SINGLES),
    satuanTerkirim: [],
    couple: String(options.couple || '').slice(0, 80),
    hasilTerkirim: false,
    coba: 0,
    berikut: 0,
    dibuat: Date.now(),
  });
  saveQueue();
  setImmediate(runQueue);
  return { kode: code, link: photoLink(code) };
}

// A new video queue item (its file follows later through videoFileReady())
const videoItem = (code, sid, label, couple) => ({
  jenis: 'video',
  kode: code,
  sid,
  label: label === 'quiz' ? 'quiz' : 'pesan',
  couple: String(couple || '').slice(0, 80),
  file: null,
  poster: null,
  posterTerkirim: false,
  uploadId: null,
  bagian: [],
  coba: 0,
  berikut: 0,
  dibuat: Date.now(),
});
// Called when a message/quiz recording ends (QR video on). The video follows through videoFileReady().
function queueVideo(sid, options = {}) {
  if (!videoEnabled()) return null;
  load();
  const code = newCode();
  queue.push(videoItem(code, sid, options.label, options.couple));
  saveQueue();
  broadcast();
  return { kode: code, link: videoLink(code) };
}
// History → "Process again" for a video whose phone version failed: the old code is kept
function requeueVideo(s) {
  load();
  if (!s || !s.kode || queue.some(x => x.kode === s.kode)) return;
  queue.push(videoItem(s.kode, s.id, s.label, s.couple));
  saveQueue();
  broadcast();
}
// The phone version has been made (video-processing.js): start uploading
function videoFileReady(code, file, poster) {
  load();
  const item = queue.find(x => isVideo(x) && x.kode === code);
  if (!item) {
    removeFile(file);
    if (poster) removeFile(poster);
    return;
  }
  Object.assign(item, {
    file,
    poster: poster || null,
    posterTerkirim: !poster,
    uploadId: null,
    bagian: [],
    berikut: 0,
  });
  saveQueue();
  broadcast();
  setImmediate(runQueue);
}
function videoFailed(code) {
  load();
  const item = queue.find(x => isVideo(x) && x.kode === code);
  if (item) {
    finishItem(item);
    saveQueue();
    broadcast();
  }
}

async function testConnection(p = settings()) {
  if (!p.url || !p.kunci) return { error: 'Enter the server address and booth key first.' };
  try {
    const r = await fetch(`${baseUrl(p.url)}/ping`, {
      headers: { authorization: 'Bearer ' + p.kunci },
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 401) return { error: 'Wrong booth key.' };
    if (!r.ok) return { error: `Server answered ${r.status}. Check the server address.` };
    const j = await r.json();
    return j.ok ? { ok: true, hari: j.hari } : { error: 'Unknown server response.' };
  } catch {
    return { error: 'Server unreachable. Check the internet and the server address.' };
  }
}

function register() {
  ipcMain.handle('unggah-status', () => status());
  ipcMain.handle('unggah-simpan', (e, input) => {
    const s = readSettings(),
      old = s.unggah || {};
    const url = baseUrl(input.url != null ? input.url : old.url);
    // https is required; http only for a test server on this computer
    if (url && !/^https:\/\/[^\s/]+/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url))
      return { ...status(), error: 'The server address must start with https://' };
    const key = input.kunci != null ? String(input.kunci).trim() : old.kunci || '';
    const on = input.aktif != null ? !!input.aktif : !!old.aktif;
    if (on && (!url || !key))
      return { ...status(), error: 'Enter the server address and booth key before turning the QR on.' };
    const video = input.video != null ? !!input.video : old.video !== false;
    const quality =
      (input.videoKualitas != null ? String(input.videoKualitas) : old.videoKualitas) === '1080' ? '1080' : '720';
    s.unggah = { aktif: on, url, kunci: key, video, videoKualitas: quality };
    writeSettings(s);
    serverFeatures = null; // the server may have changed: ask again
    log.write(`QR settings saved: ${on ? 'on' : 'off'}, video ${video ? quality + 'p' : 'off'}, server ${url || '-'}`); // the key is never logged
    setImmediate(runQueue);
    return status();
  });
  ipcMain.handle('unggah-tes', () => testConnection());
  // Fill in the address & key from the result of "npm run cloud:pasang"
  ipcMain.handle('unggah-hasil-pasang', () => {
    const h = readJSON(SETUP_RESULT, null);
    if (!h || !h.url || !h.kunci) return { error: 'No setup result yet. Run first: npm run cloud:pasang' };
    return { url: h.url, kunci: h.kunci };
  });
  // From Session history: open the photo link in the browser / copy the link
  ipcMain.handle('buka-link', (e, url) => {
    if (!/^https:\/\/[^\s]+$/.test(String(url || ''))) return { error: 'Invalid link.' };
    shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('salin-teks', (e, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });
  ipcMain.handle('unggah-coba-sekarang', () => {
    queue.forEach(x => {
      x.berikut = 0;
    });
    saveQueue();
    runQueue();
    return status();
  });
}
// When the app opens: continue the remaining queue
function start() {
  load();
  queue.forEach(x => {
    x.berikut = 0;
  });
  // Clean up temporary single photos that are no longer in the queue
  try {
    const used = new Set(queue.flatMap(x => x.satuan || []));
    for (const f of fs.readdirSync(SINGLES_DIR)) {
      const p = path.join(SINGLES_DIR, f);
      if (!used.has(p)) removeFile(p);
    }
  } catch {
    /* the single photos folder doesn't exist yet */
  }
  // Phone versions of videos that are no longer in the queue
  try {
    const folder = path.join(userData, 'qr-video');
    const used = new Set(
      queue
        .filter(isVideo)
        .flatMap(x => [x.file, x.poster])
        .filter(Boolean),
    );
    const processing = new Set(queue.filter(x => isVideo(x) && !x.file).map(x => String(x.sid)));
    for (const f of fs.readdirSync(folder)) {
      const p = path.join(folder, f);
      if (!used.has(p) && !processing.has(f.split('.')[0])) removeFile(p);
    }
  } catch {
    /* the phone version folder doesn't exist yet */
  }
  setTimeout(runQueue, 2000);
}

module.exports = {
  register,
  start,
  queuePhoto,
  saveSinglePhotos,
  ready,
  status,
  newCode,
  videoEnabled,
  videoQuality,
  queueVideo,
  requeueVideo,
  videoFileReady,
  videoFailed,
};
