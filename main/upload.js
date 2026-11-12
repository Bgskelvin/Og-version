/* =====================================================================
   upload.js — photo download by QR: code, link, and the upload queue.
   - Every photobooth session gets a random code; the link & QR exist right
     away, even while the internet is down.
   - Result photos go into a queue saved on disk (upload-queue.json),
     uploaded one at a time to the Cloudflare server (cloud/worker.mjs), and
     retried automatically on failure — also after the app is opened again.
   - Single photos (1-4, without template) are uploaded AFTER every result photo
     has been sent, so each QR opens quickly. Kept temporarily in
     <data folder>/qr-singles/ and deleted after sending.
   - Video (message & quiz): the code & link exist as soon as the recording ends;
     the "phone version" is made by video-processing.js, then uploaded IN 8 MB
     PARTS (can resume if the internet drops). Photos always go first:
     new photos are sent between the video parts.
   The server protocol (cloud/worker.mjs: paths, x-leura-* headers, JSON fields
   such as satuan, bagian, hari) keeps its Indonesian words, so a server that
   is already installed keeps working without npm run cloud:pasang.
   ===================================================================== */
const { ipcMain, shell, clipboard } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { userData, readJSON, writeJSON, readSettings, writeSettings, updateSession } = require('./storage');
const { getWin } = require('./active-window');
const log = require('./log');

const QUEUE_FILE = path.join(userData, 'upload-queue.json');
const SINGLES_DIR = path.join(userData, 'qr-singles');
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
  const u = readSettings().upload || {};
  return {
    enabled: !!u.enabled,
    url: u.url || '',
    key: u.key || '',
    video: u.video !== false,
    videoQuality: u.videoQuality === '1080' ? '1080' : '720',
  };
};
const ready = () => {
  const p = settings();
  return p.enabled && !!p.url && !!p.key;
};
const videoEnabled = () => ready() && settings().video;
const videoQuality = () => settings().videoQuality;
const baseUrl = url =>
  String(url || '')
    .trim()
    .replace(/\/+$/, '');
const newCode = () => Array.from({ length: 10 }, () => LETTERS[crypto.randomInt(LETTERS.length)]).join('');
const photoLink = code => baseUrl(settings().url) + '/f/' + code;
const videoLink = code => baseUrl(settings().url) + '/v/' + code;
const isVideo = x => x.kind === 'video';

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
    enabled: p.enabled,
    url: p.url,
    hasKey: !!p.key,
    video: p.video,
    videoQuality: p.videoQuality,
    waiting: queue.filter(x => !isVideo(x) && !x.resultSent).length,
    waitingSingles: queue.reduce((n, x) => n + singlesLeft(x).length, 0),
    waitingVideos: queue.filter(isVideo).length,
    videosProcessing: queue.filter(x => isVideo(x) && !x.file).length,
    sent: st.sent,
    sentVideos: st.sentVideos,
    lastError: st.lastError,
    current: st.current,
    progress: st.progress,
    hasSetupResult: fs.existsSync(SETUP_RESULT),
  };
}
function broadcast() {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('upload-status', status());
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
  (item.singles || []).map((f, i) => i + 1).filter(n => !(item.singlesSent || []).includes(n));

// An old server (from before single photos / video) doesn't know the new features — single photos would even
// OVERWRITE the result photo. So ask once first: a new server answers /ping with satuan: true, video: true.
let serverFeatures = null;
async function serverSupports(p, feature) {
  if (serverFeatures === null) {
    try {
      const r = await fetch(`${baseUrl(p.url)}/ping`, {
        headers: { authorization: 'Bearer ' + p.key },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return null; // unknown yet (internet?) — try again later
      const j = await r.json();
      serverFeatures = { singles: !!j.satuan, video: !!j.video }; // server answers in its own words
      if (!serverFeatures.singles)
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
    data = fs.readFileSync(n ? item.singles[n - 1] : item.file);
  } catch {
    return MISSING;
  }
  const ctrl = new AbortController();
  const limit = setTimeout(() => ctrl.abort(), 60000);
  const headers = { authorization: 'Bearer ' + p.key, 'content-type': 'image/jpeg' };
  if (!n) {
    headers['x-leura-jumlah'] = String((item.singles || []).length);
    if (item.couple) headers['x-leura-couple'] = encodeURIComponent(item.couple);
  }
  try {
    const r = await fetch(`${baseUrl(p.url)}/u/${item.code}${n ? '/' + n : ''}`, {
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
  (item.singles || []).forEach(removeFile);
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
      headers: { authorization: 'Bearer ' + p.key, ...(options.headers || {}) },
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
  const base = `/uv/${item.code}`;
  if (!item.posterSent && item.poster) {
    let data;
    try {
      data = fs.readFileSync(item.poster);
    } catch {
      item.posterSent = true;
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
    item.posterSent = true;
    return '';
  }
  if (!item.uploadId) {
    const headers = { 'x-leura-jenis': item.label === 'quiz' ? 'quiz' : 'pesan', 'x-leura-ukuran': String(size) };
    if (item.couple) headers['x-leura-couple'] = encodeURIComponent(item.couple);
    const { r, j, fault } = await request(p, base + '/mulai', { method: 'POST', headers }, 60000);
    if (fault) return fault;
    if (!r.ok) return refused(r, j);
    if (j.ada) {
      item.sent = true;
      return '';
    } // already arrived earlier (e.g. the app was closed while finishing)
    item.uploadId = j.uploadId;
    item.parts = [];
    return '';
  }
  const q = '?u=' + encodeURIComponent(item.uploadId);
  if (item.parts.length < total) {
    const n = item.parts.length + 1;
    const buf = Buffer.alloc(Math.min(PART_SIZE, size - (n - 1) * PART_SIZE));
    try {
      const fd = fs.openSync(item.file, 'r');
      fs.readSync(fd, buf, 0, buf.length, (n - 1) * PART_SIZE);
      fs.closeSync(fd);
    } catch {
      return MISSING;
    }
    st.progress = { code: item.code, n, total };
    const { r, j, fault } = await request(p, `${base}/${n}${q}`, {
      method: 'PUT',
      body: buf,
      headers: { 'content-type': 'application/octet-stream' },
    });
    if (fault) return fault;
    if (r.status === 404 && j.error === 'upload-hilang') {
      item.uploadId = null;
      item.parts = [];
      return 'Upload expired on the server, starting again';
    }
    if (!r.ok || !j.etag) return refused(r, j);
    item.parts.push({ partNumber: n, etag: j.etag });
    return '';
  }
  const { r, j, fault } = await request(p, `${base}/selesai${q}`, {
    method: 'POST',
    body: JSON.stringify({ bagian: item.parts }), // server protocol keeps its field names
    headers: { 'content-type': 'application/json' },
  });
  if (fault) return fault;
  if (r.status === 404 && j.error === 'upload-hilang') {
    item.uploadId = null;
    item.parts = [];
    return 'Upload expired on the server, starting again';
  }
  if (!r.ok) return refused(r, j);
  item.sent = true;
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
        due = x => (x.nextTry || 0) <= now;
      const photos = queue.filter(x => !isVideo(x));
      let item = photos.find(x => !x.resultSent && due(x)),
        n = 0;
      if (!item && !photos.some(x => !x.resultSent)) {
        item = photos.find(x => due(x) && singlesLeft(x).length);
        if (item) {
          const supported = await serverSupports(settings(), 'singles');
          if (supported === false) {
            photos.filter(x => x.resultSent).forEach(finishItem);
            saveQueue();
            broadcast();
            continue;
          }
          if (supported === null) {
            item.nextTry = Date.now() + 15000;
            saveQueue();
            continue;
          }
          n = singlesLeft(item)[0];
        }
      }
      // Video: after every photo (result & single) has been sent, one part per round
      if (!item && !photos.some(x => !x.resultSent || singlesLeft(x).length)) {
        const video = queue.find(x => isVideo(x) && x.file && due(x));
        if (video) {
          const supported = await serverSupports(settings(), 'video');
          if (supported === false) {
            queue.filter(isVideo).forEach(x => {
              if (x.sid) updateSession(x.sid, { upload: 'old-server' });
              finishItem(x);
            });
            saveQueue();
            broadcast();
            continue;
          }
          if (supported === null) {
            video.nextTry = Date.now() + 15000;
            saveQueue();
            continue;
          }
          st.current = video.code;
          broadcast();
          const err = await sendVideo(video, settings());
          st.current = null;
          if (err === MISSING) {
            log.error(`QR ${video.code}: video file missing, cannot be sent`);
            if (video.sid) updateSession(video.sid, { upload: 'missing' });
            finishItem(video);
            st.progress = null;
          } else if (!err) {
            video.attempts = 0;
            st.lastError = '';
            if (video.sent) {
              log.write(`QR ${video.code}: video sent (${video.parts ? video.parts.length : 0} parts)`);
              if (video.sid) updateSession(video.sid, { upload: 'sent' });
              finishItem(video);
              st.sentVideos++;
              st.progress = null;
            }
          } else {
            video.attempts = (video.attempts || 0) + 1;
            if (err !== st.lastError)
              log.warn(`QR ${video.code}: video not sent yet — ${err} (retrying automatically)`);
            video.nextTry = Date.now() + Math.min(60000, 3000 * 2 ** Math.min(video.attempts, 5));
            st.lastError = err;
            if (video.sid) updateSession(video.sid, { upload: 'waiting' });
          }
          saveQueue();
          broadcast();
          continue;
        }
      }
      if (!item) break;
      st.current = item.code;
      broadcast();
      const err = await sendPhoto(item, settings(), n);
      st.current = null;
      if (n && (!err || err === MISSING)) {
        // single photo
        item.singlesSent = [...(item.singlesSent || []), n];
        if (err) log.warn(`QR ${item.code}: single photo ${n} missing, skipped`);
        item.attempts = 0;
        st.lastError = err ? st.lastError : '';
        if (!singlesLeft(item).length) {
          finishItem(item);
          log.write(`QR ${item.code}: ${item.singles.length} single photos sent`);
        }
      } else if (!err || err === MISSING) {
        // result photo
        if (err) log.error(`QR ${item.code}: photo file missing, cannot be sent (${path.basename(item.file)})`);
        else
          log.write(`QR ${item.code}: photo sent${item.attempts ? ` (after ${item.attempts} failed attempt(s))` : ''}`);
        item.resultSent = true;
        item.attempts = 0;
        if (err || !singlesLeft(item).length) finishItem(item);
        if (item.sid) updateSession(item.sid, { upload: err ? 'missing' : 'sent' });
        if (!err) {
          st.sent++;
          st.lastError = '';
        }
      } else {
        item.attempts = (item.attempts || 0) + 1;
        if (err !== st.lastError)
          log.warn(
            `QR ${item.code}: ${n ? 'single photo ' + n + ' ' : ''}not sent yet — ${err} (retrying automatically)`,
          );
        item.nextTry = Date.now() + Math.min(60000, 3000 * 2 ** Math.min(item.attempts, 5));
        st.lastError = err;
        if (item.sid && !n) updateSession(item.sid, { upload: 'waiting' });
      }
      saveQueue();
      broadcast();
    }
  } finally {
    running = false;
    const sendable = queue.filter(x => !isVideo(x) || x.file); // videos still being processed can't be sent yet
    if (sendable.length && ready()) {
      const wait = Math.max(500, Math.min(...sendable.map(x => (x.nextTry || 0) - Date.now())));
      timer = setTimeout(runQueue, wait);
    }
  }
}

// Called when a photobooth photo is saved. Returns { kode, link } or null when QR is off.
// options.satuan: single photo files (from saveSinglePhotos); options.couple: couple name for the download page
function queuePhoto(file, sid, options = {}) {
  if (!ready()) {
    (options.singles || []).forEach(removeFile);
    return null;
  }
  load();
  const code = newCode();
  queue.push({
    code,
    file,
    sid,
    singles: (options.singles || []).slice(0, MAX_SINGLES),
    singlesSent: [],
    couple: String(options.couple || '').slice(0, 80),
    resultSent: false,
    attempts: 0,
    nextTry: 0,
    created: Date.now(),
  });
  saveQueue();
  setImmediate(runQueue);
  return { code, link: photoLink(code) };
}

// A new video queue item (its file follows later through videoFileReady())
const videoItem = (code, sid, label, couple) => ({
  kind: 'video',
  code,
  sid,
  label: label === 'quiz' ? 'quiz' : 'message',
  couple: String(couple || '').slice(0, 80),
  file: null,
  poster: null,
  posterSent: false,
  uploadId: null,
  parts: [],
  attempts: 0,
  nextTry: 0,
  created: Date.now(),
});
// Called when a message/quiz recording ends (QR video on). The video follows through videoFileReady().
function queueVideo(sid, options = {}) {
  if (!videoEnabled()) return null;
  load();
  const code = newCode();
  queue.push(videoItem(code, sid, options.label, options.couple));
  saveQueue();
  broadcast();
  return { code, link: videoLink(code) };
}
// History → "Process again" for a video whose phone version failed: the old code is kept
function requeueVideo(s) {
  load();
  if (!s || !s.code || queue.some(x => x.code === s.code)) return;
  queue.push(videoItem(s.code, s.id, s.label, s.couple));
  saveQueue();
  broadcast();
}
// The phone version has been made (video-processing.js): start uploading
function videoFileReady(code, file, poster) {
  load();
  const item = queue.find(x => isVideo(x) && x.code === code);
  if (!item) {
    removeFile(file);
    if (poster) removeFile(poster);
    return;
  }
  Object.assign(item, {
    file,
    poster: poster || null,
    posterSent: !poster,
    uploadId: null,
    parts: [],
    nextTry: 0,
  });
  saveQueue();
  broadcast();
  setImmediate(runQueue);
}
function videoFailed(code) {
  load();
  const item = queue.find(x => isVideo(x) && x.code === code);
  if (item) {
    finishItem(item);
    saveQueue();
    broadcast();
  }
}

async function testConnection(p = settings()) {
  if (!p.url || !p.key) return { error: 'Enter the server address and booth key first.' };
  try {
    const r = await fetch(`${baseUrl(p.url)}/ping`, {
      headers: { authorization: 'Bearer ' + p.key },
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 401) return { error: 'Wrong booth key.' };
    if (!r.ok) return { error: `Server answered ${r.status}. Check the server address.` };
    const j = await r.json();
    return j.ok ? { ok: true, days: j.hari } : { error: 'Unknown server response.' };
  } catch {
    return { error: 'Server unreachable. Check the internet and the server address.' };
  }
}

function register() {
  ipcMain.handle('upload-status', () => status());
  ipcMain.handle('save-upload-settings', (e, input) => {
    const s = readSettings(),
      old = s.upload || {};
    const url = baseUrl(input.url != null ? input.url : old.url);
    // https is required; http only for a test server on this computer
    if (url && !/^https:\/\/[^\s/]+/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url))
      return { ...status(), error: 'The server address must start with https://' };
    const key = input.key != null ? String(input.key).trim() : old.key || '';
    const on = input.enabled != null ? !!input.enabled : !!old.enabled;
    if (on && (!url || !key))
      return { ...status(), error: 'Enter the server address and booth key before turning the QR on.' };
    const video = input.video != null ? !!input.video : old.video !== false;
    const quality =
      (input.videoQuality != null ? String(input.videoQuality) : old.videoQuality) === '1080' ? '1080' : '720';
    s.upload = { enabled: on, url, key, video, videoQuality: quality };
    writeSettings(s);
    serverFeatures = null; // the server may have changed: ask again
    log.write(`QR settings saved: ${on ? 'on' : 'off'}, video ${video ? quality + 'p' : 'off'}, server ${url || '-'}`); // the key is never logged
    setImmediate(runQueue);
    return status();
  });
  ipcMain.handle('test-upload', () => testConnection());
  // Fill in the address & key from the result of "npm run cloud:pasang"
  ipcMain.handle('upload-setup-result', () => {
    const h = readJSON(SETUP_RESULT, null);
    if (!h || !h.url || !h.key) return { error: 'No setup result yet. Run first: npm run cloud:pasang' };
    return { url: h.url, key: h.key };
  });
  // From Session history: open the photo link in the browser / copy the link
  ipcMain.handle('open-link', (e, url) => {
    if (!/^https:\/\/[^\s]+$/.test(String(url || ''))) return { error: 'Invalid link.' };
    shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('copy-text', (e, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });
  ipcMain.handle('retry-upload-now', () => {
    queue.forEach(x => {
      x.nextTry = 0;
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
    x.nextTry = 0;
  });
  // Clean up temporary single photos that are no longer in the queue
  try {
    const used = new Set(queue.flatMap(x => x.singles || []));
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
