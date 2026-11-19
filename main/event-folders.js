/* =====================================================================
   event-folders.js — how recordings, photos and prints are laid out on disk
   (PlaygroundBooth 1.10.0). One folder per wedding, sorted by date, one subfolder per
   kind, and one number per guest across all subfolders:

     <storage folder>/2026-11-22 Rina & Dimas/
       1 Pesan Video/   001 Budi.mp4 · 004 Andi.mp4
       2 Quiz/          002 Sari.mp4
       3 Foto/          003 Budi.jpg            the template photo, ready to share
       4 Foto Asli/     003 Budi/1.jpg … 4.jpg  the camera's original photos
       5 Cetak/         003 Budi.jpg            what was printed (PDF when testing)
       Album.html       a gallery per guest (album.js)
       .playgroundbooth/ technical files (original .webm, quiz video without text)

   - The event folder name is kept on the couple (couple.folder), so it never
     changes, also not when the couple is renamed later.
   - Guest number: one per visit (Start → … → Start). The screen sends a visit
     id with every recording and photo session; every session of that visit
     gets the same number (session.seq). Subfolders appear only when used.
   - A second file of the same guest in the same folder gets " (2)", " (3)" …
   - reorganize() moves the data of older versions (couple folder with
     Foto/, original/, Foto/Print/) into this layout once, when the app opens.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  db,
  userData,
  defaultDir,
  getOutDir,
  usableDir,
  safeName,
  guestFileName,
  readSessions,
  writeSessions,
  stamp,
} = require('./storage');

const KIND_DIRS = {
  message: '1 Pesan Video',
  quiz: '2 Quiz',
  photo: '3 Foto',
  original: '4 Foto Asli',
  print: '5 Cetak',
};
const SYSTEM_DIR = '.playgroundbooth';
const FORMER_SYSTEM_DIR = '.leura'; // the app's former name (before 1.11.0)
const ALBUM_FILE = 'Album.html';
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const seqText = n => String(n).padStart(3, '0');

// The storage folder chosen in Admin, or the default one when it isn't available (SSD unplugged)
function baseDir() {
  const chosen = getOutDir();
  if (usableDir(chosen)) return { dir: chosen, fallback: false };
  if (usableDir(defaultDir)) return { dir: defaultDir, fallback: true };
  return null;
}

// "2026-11-22 Rina & Dimas"
const folderNameFor = (name, date = new Date()) => [ymd(date), safeName(name)].filter(Boolean).join(' ');

/* The event folder of a couple (the active couple when no name is given). Made the first time it is needed
   and remembered on the couple, so later sessions — and a renamed couple — keep using the same folder. */
function eventFor(coupleName) {
  const { readCouples, saveCoupleFolder } = require('./couple');
  const d = readCouples();
  const couple =
    coupleName == null ? d.couples.find(c => c.id === d.activeId) : d.couples.find(c => c.name === coupleName);
  const name = couple ? couple.name : String(coupleName || '');
  let folder = couple && couple.folder;
  if (!folder) {
    folder = folderNameFor(name);
    if (couple) saveCoupleFolder(couple.id, folder);
  }
  const base = baseDir();
  if (!base) return null;
  return { name, folder, dir: path.join(base.dir, folder), fallback: base.fallback };
}

// Folder of one kind inside an event, made when first used
function kindDir(event, kind) {
  const dir = path.join(event.dir, KIND_DIRS[kind]);
  return usableDir(dir) ? dir : null;
}
// .playgroundbooth/<sub> inside an event (hidden on Windows too)
function systemDir(eventDir, sub) {
  const top = path.join(eventDir, SYSTEM_DIR);
  const isNew = !fs.existsSync(top);
  const dir = sub ? path.join(top, sub) : top;
  fs.mkdirSync(dir, { recursive: true });
  if (isNew && process.platform === 'win32') {
    try {
      spawn('attrib', ['+h', top], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    } catch {
      /* hiding is only cosmetic */
    }
  }
  return dir;
}
/* Where the technical copy of a video goes (the original .webm, the quiz video without text).
   New layout: <event>/.playgroundbooth/original. Sessions from before stay with original/ next to the video. */
function originalDirFor(videoDir) {
  const parent = path.dirname(videoDir);
  if (Object.values(KIND_DIRS).includes(path.basename(videoDir))) return systemDir(parent, 'original');
  return path.join(videoDir, 'original');
}
// The event folder of a session in the new layout (null for older sessions)
const eventDirOf = s => (s && s.event && s.dir ? path.dirname(s.dir) : null);

/* The guest number for a visit: the same number for every session of that visit, otherwise the next one */
function guestNumber(event, visit) {
  let max = 0;
  for (const s of readSessions()) {
    if (s.event !== event.folder) continue;
    if (visit && s.visit === visit && s.seq) return s.seq;
    max = Math.max(max, Number(s.seq) || 0);
  }
  return max + 1;
}
// "003 Budi", then "003 Budi (2)", … (isTaken(base) says whether a name is used)
function freeName(base, isTaken) {
  if (!isTaken(base)) return base;
  for (let n = 2; n < 1000; n++) if (!isTaken(`${base} (${n})`)) return `${base} (${n})`;
  return `${base} (${Date.now()})`;
}
const baseNameFor = (seq, guest) => [seqText(seq), guestFileName(guest)].filter(Boolean).join(' ');

/* Where a new session's file goes. kind: 'message' | 'quiz' | 'photo'. ext without dot.
   Returns { event, dir, base, seq } or null when no folder can be written. */
function target(kind, { guest, visit, ext, coupleName } = {}) {
  const event = eventFor(coupleName);
  if (!event || !usableDir(event.dir)) return null;
  const dir = kindDir(event, kind === 'quiz' || kind === 'message' || kind === 'photo' ? kind : 'message');
  if (!dir) return null;
  const seq = guestNumber(event, visit);
  const used = new Set(
    readSessions()
      .filter(s => s.dir === dir)
      .map(s => String(s.file || '').replace(/\.[^.]+$/, '')),
  );
  const exts = ext ? [ext, 'mp4', 'webm', 'jpg'] : ['mp4', 'webm', 'jpg'];
  const base = freeName(
    baseNameFor(seq, guest),
    b => used.has(b) || exts.some(x => fs.existsSync(path.join(dir, `${b}.${x}`))),
  );
  return { event, dir, base, seq };
}

/* ---------------------------------------------------------------------
   reorganize(): data of PlaygroundBooth 1.9 and older → the new layout. Runs once
   per session (sessions get an `event` field), when the app opens, before
   anything else reads the files:
   - the couple folder is renamed to "<date of its first session> <couple>"
     (one quick rename on the same disk), then every known file is moved into
     its subfolder and renamed with its guest number;
   - the database (sessions, QR upload queue, print queue) is updated per file,
     right after that file moved, so a file is never lost: a file that can't be
     moved stays where it is and its session keeps pointing at it;
   - files PlaygroundBooth doesn't know about stay where they are; empty old folders are
     removed; a list of every move is kept in <data>/backup/event-folders-<time>.json.
   - a disk that isn't connected (SSD unplugged) is skipped and tried next time.
   --------------------------------------------------------------------- */
const VISIT_GAP_MS = 20 * 60 * 1000; // same guest name within 20 minutes = the same visit
function reorganize() {
  const notes = [];
  const sessions = readSessions();
  const old = sessions.filter(s => !s.event && s.dir && s.file);
  if (!old.length) return notes;
  const { readCouples, saveCoupleFolder } = require('./couple');
  const moves = [];
  const move = (from, to) => {
    if (!fs.existsSync(from)) return false;
    if (path.resolve(from) === path.resolve(to)) return true;
    if (fs.existsSync(to)) return false; // never overwrite
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    moves.push([from, to]);
    return true;
  };
  const tryMove = (from, to) => {
    try {
      return move(from, to);
    } catch (e) {
      notes.push({ level: 'warn', text: `Could not move ${from}: ${e.message}` });
      return false;
    }
  };

  // The QR upload queue points at result photos by path: follow every move so far
  function syncQueues() {
    if (!moves.length) return;
    const resolveNew = p => {
      if (!p) return p;
      let r = path.resolve(p);
      for (const [from, to] of moves) {
        if (r === path.resolve(from)) return to;
        if (r.startsWith(path.resolve(from) + path.sep)) r = path.join(to, path.relative(from, r));
      }
      return r;
    };
    const uq = db.readUploadQueue();
    let changed = false;
    for (const item of uq)
      if (item.file && !item.file.startsWith(userData)) {
        const n = resolveNew(item.file);
        if (n !== path.resolve(item.file)) {
          item.file = n;
          changed = true;
        }
      }
    if (changed) db.writeUploadQueue(uq);
  }

  // Group by the couple folder each session lives in (photos lived in <couple>/Foto)
  const coupleDirOf = s => (s.label === 'photo' && path.basename(s.dir) === 'Foto' ? path.dirname(s.dir) : s.dir);
  const groups = new Map();
  for (const s of old) {
    const key = path.resolve(coupleDirOf(s));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const couples = readCouples();
  let movedFiles = 0;
  for (const [oldDir, list] of groups) {
    if (!fs.existsSync(oldDir)) continue; // disk not connected: next time
    list.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const name = list[0].couple || '';
    const couple = couples.couples.find(c => c.name === name);
    const first = new Date(list[0].time);
    const folder = (couple && couple.folder) || folderNameFor(name, isNaN(first) ? new Date() : first);
    if (couple && !couple.folder) saveCoupleFolder(couple.id, folder);
    // The couple folder itself becomes the event folder (only a real couple folder, never the storage folder)
    const eventDir = path.join(path.dirname(oldDir), folder);
    const isCoupleFolder = safeName(name) && path.basename(oldDir) === safeName(name);
    if (isCoupleFolder && !fs.existsSync(eventDir)) {
      try {
        fs.renameSync(oldDir, eventDir);
        moves.push([oldDir, eventDir]);
      } catch (e) {
        notes.push({ level: 'warn', text: `Couple folder not renamed (${e.message}); files are moved one by one` });
      }
    }
    const renamed = fs.existsSync(eventDir) && !fs.existsSync(oldDir);
    // Where an old path is now (paths already in the event folder stay as they are)
    const inside = (p, dir) =>
      path.resolve(p) === path.resolve(dir) || path.resolve(p).startsWith(path.resolve(dir) + path.sep);
    const inEvent = p => (renamed && inside(p, oldDir) ? path.join(eventDir, path.relative(oldDir, p)) : p);
    if (renamed) {
      // Save the new folder right away, so a crash halfway never leaves sessions pointing at the old name
      for (const s of list) s.dir = inEvent(s.dir);
      syncQueues();
      writeSessions(sessions);
    }

    // Guest numbers: one per visit (same guest name within 20 minutes), in time order
    const existingMax = Math.max(0, ...sessions.filter(x => x.event === folder).map(x => Number(x.seq) || 0));
    let seq = existingMax;
    const lastByGuest = new Map();
    for (const s of list) {
      const t = Date.parse(s.time) || 0;
      const g = String(s.guest || '').trim();
      const prev = g && lastByGuest.get(g);
      s.seq = prev && t - prev.t <= VISIT_GAP_MS ? prev.seq : ++seq;
      if (g) lastByGuest.set(g, { t, seq: s.seq });
    }

    for (const s of list) {
      const kind = s.label === 'photo' ? 'photo' : /^quiz/.test(s.label) ? 'quiz' : 'message';
      const dir = path.join(eventDir, KIND_DIRS[kind]);
      const ext = path.extname(s.file) || (kind === 'photo' ? '.jpg' : '.mp4');
      const oldFile = inEvent(path.join(s.dir, s.file));
      const used = name => fs.existsSync(path.join(dir, name + ext)) || fs.existsSync(path.join(dir, name + '.mp4'));
      const base = freeName(baseNameFor(s.seq, s.guest), used);
      const newFile = path.join(dir, base + ext);
      // card-only / lost: there is no file yet; the session simply points at the new place
      const exists = fs.existsSync(oldFile);
      if (exists && !tryMove(oldFile, newFile)) continue; // stays where it is (file locked / name taken): tried next time
      if (exists) movedFiles++;
      const oldFileName = s.file;
      s.dir = dir;
      s.file = base + ext;
      // Technical copies next to the old video: original/<name>.webm and original/<name>_original.mp4
      const oldBase = oldFileName.replace(/\.[^.]+$/, '');
      const oldOriginal = path.join(path.dirname(oldFile), 'original');
      for (const [from, to] of [
        [`${oldBase}.webm`, `${base}.webm`],
        [`${oldBase}_original.mp4`, `${base}_original.mp4`],
      ]) {
        const src = path.join(oldOriginal, from);
        if (!fs.existsSync(src)) continue;
        const dest = path.join(systemDir(eventDir, 'original'), to);
        if (tryMove(src, dest) && to.endsWith('_original.mp4')) s.originalFile = path.relative(dir, dest);
      }
      // Photos: the 4 original photos → 4 Foto Asli/<base>/1.jpg …
      if (kind === 'photo' && Array.isArray(s.originalFiles)) {
        const target = path.join(eventDir, KIND_DIRS.original, base);
        const done = [];
        s.originalFiles.forEach((f, i) => {
          const src = path.join(path.dirname(oldFile), f);
          const to = path.join(target, `${i + 1}${path.extname(f) || '.jpg'}`);
          if (tryMove(src, to)) done.push(path.basename(to));
          else done.push(path.relative(target, src));
        });
        s.originalsDir = target;
        s.originalFiles = done;
      }
      s.event = folder;
    }
    syncQueues();
    writeSessions(sessions);

    // Prints: <couple>/Foto/Print/* → 5 Cetak/ (named after their session when known)
    const oldPrintDir = inEvent(path.join(oldDir, 'Foto', 'Print'));
    const queue = db.getState('printQueue', []);
    if (Array.isArray(queue)) {
      for (const job of queue) {
        for (const key of ['file', 'pdfFile']) {
          if (!job[key]) continue;
          const now = inEvent(job[key]);
          if (path.resolve(path.dirname(now)) !== path.resolve(oldPrintDir)) continue;
          const s = job.sessionId && list.find(x => x.id === job.sessionId);
          const ext = path.extname(now);
          const printDir = path.join(eventDir, KIND_DIRS.print);
          const want = s ? s.file.replace(/\.[^.]+$/, '') : path.basename(now, ext).replace(/_print(_x\d+)?$/, '');
          const base = freeName(want, b => fs.existsSync(path.join(printDir, b + ext)));
          const to = path.join(printDir, base + ext);
          if (fs.existsSync(now) ? tryMove(now, to) : true) job[key] = fs.existsSync(now) ? now : to;
        }
      }
      db.setState('printQueue', queue);
    }
    if (fs.existsSync(oldPrintDir))
      for (const f of fs.readdirSync(oldPrintDir)) {
        const to = path.join(eventDir, KIND_DIRS.print, f.replace(/_print(?=[._])/, ''));
        tryMove(path.join(oldPrintDir, f), to);
      }
    // Old folders that are empty now
    for (const d of [
      oldPrintDir,
      inEvent(path.join(oldDir, 'Foto', 'original')),
      inEvent(path.join(oldDir, 'Foto')),
      inEvent(path.join(oldDir, 'original')),
      oldDir,
    ]) {
      try {
        if (fs.existsSync(d) && !fs.readdirSync(d).length) fs.rmdirSync(d);
      } catch {
        /* not empty or in use: it stays */
      }
    }
  }

  writeSessions(sessions);
  if (moves.length) {
    try {
      const dir = path.join(userData, 'backup');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `event-folders-${stamp()}.json`), JSON.stringify(moves, null, 1));
    } catch (e) {
      notes.push({ level: 'warn', text: 'The list of moved files could not be saved: ' + e.message });
    }
  }
  notes.push({
    level: 'info',
    text: `Event folders: ${old.length} session(s) arranged into the new layout, ${movedFiles} file(s) moved`,
  });
  return notes;
}

/* renameFormerSystemDirs(): <event>/.leura → <event>/.playgroundbooth (the app's former name),
   once per event folder, and the sessions that point into it follow. Never overwrites. */
function renameFormerSystemDirs() {
  const notes = [];
  const sessions = readSessions();
  const done = new Map(); // event folder → renamed?
  let changed = false;
  for (const s of sessions) {
    const eventDir = eventDirOf(s);
    if (!eventDir) continue;
    if (!done.has(eventDir)) {
      const from = path.join(eventDir, FORMER_SYSTEM_DIR);
      const to = path.join(eventDir, SYSTEM_DIR);
      let ok = false;
      try {
        if (fs.existsSync(from) && !fs.existsSync(to)) {
          fs.renameSync(from, to);
          ok = true;
        }
      } catch (e) {
        notes.push({ level: 'warn', text: `Could not rename ${from}: ${e.message}` });
      }
      done.set(eventDir, ok || (fs.existsSync(to) && !fs.existsSync(from)));
    }
    if (done.get(eventDir) && typeof s.originalFile === 'string') {
      const parts = s.originalFile.split(/[\\/]/);
      const i = parts.indexOf(FORMER_SYSTEM_DIR);
      if (i >= 0) {
        parts[i] = SYSTEM_DIR;
        s.originalFile = parts.join(path.sep);
        changed = true;
      }
    }
  }
  if (changed) writeSessions(sessions);
  const renamed = [...done.values()].filter(Boolean).length;
  if (changed || renamed)
    notes.push({ level: 'info', text: `Technical folders renamed to ${SYSTEM_DIR} (new app name)` });
  return notes;
}

module.exports = {
  renameFormerSystemDirs,
  KIND_DIRS,
  SYSTEM_DIR,
  ALBUM_FILE,
  baseDir,
  eventFor,
  kindDir,
  systemDir,
  originalDirFor,
  eventDirOf,
  target,
  freeName,
  folderNameFor,
  reorganize,
};
