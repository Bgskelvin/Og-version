/* =====================================================================
   migrate.js — brings data saved by older Leura versions up to date.
   Leura 1.1.x and older saved its data with Indonesian field names
   (settings.json: tanyaNama, kamera, unggah.kunci, …; sessions.json: tamu,
   kode, unggah: 'antre', …) and folder names (catatan/, kapsi/, qr-satuan/).
   From 1.2.0 the names are English. This runs when the app opens, before
   any other module reads the data:
   - Every step only renames what is still old, so it is safe to run every
     time (also after an older Leura version was opened again in between).
   - Before the first change, the old files are copied to
     <data folder>/backup/before-english-data-<time>/. Nothing is deleted.
   - A file that is changed is saved the safe way (storage.writeJSON), and
     its .bak copy is refreshed too, so a fallback never brings old names back.
   - If something goes wrong, the app still opens; the step is tried again
     the next time. Recordings and photos in the couple folders are never touched.
   From 1.4.0 settings, couples, session history and the QR upload queue are
   kept in the database (database.js). The last step moves them from the JSON
   files into it, then moves the JSON files to
   <data folder>/backup/before-database-<time>/.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const { userData, defaultDir, readJSON, writeJSON, stamp } = require('./storage');
const { openDatabase } = require('./database');

/* ---------- Old name → new name ---------- */
const SETTINGS_KEYS = {
  pesanCountdown: 'messageCountdown',
  pesanMaxSeconds: 'messageMaxSeconds',
  enablePesan: 'enableMessage',
  tanyaNama: 'askName',
  kamera: 'camera',
  bahasa: 'language',
  unggah: 'upload',
};
const UPLOAD_SETTINGS_KEYS = { aktif: 'enabled', kunci: 'key', videoKualitas: 'videoQuality' };
const MENU_KEYS = { pesan: 'message' };
const TEMPLATE_KEYS = {
  nama: 'name',
  ukuran: 'size',
  latarWarna: 'backgroundColor',
  rasio: 'ratio',
  filterKekuatan: 'filterStrength',
  filterTamu: 'guestPicksFilter',
  dibuat: 'created',
  diubah: 'changed',
};
const TEMPLATE_SIZES = { '4r-tegak': '4r-portrait', '4r-datar': '4r-landscape', persegi: 'square' };
const TEMPLATE_IMAGES = { latar: 'background', bingkai: 'frame' };
const FILTER_KEYS = { nama: 'name', dibuat: 'created' };
const SESSION_KEYS = {
  tamu: 'guest',
  kamera: 'camera',
  kode: 'code',
  unggah: 'upload',
  teks: 'captionStatus',
  kapsi: 'captions',
  fileAsli: 'originalFile',
  kartu: 'cardFile',
  kartuInfo: 'cardInfo',
  bingkai: 'frame',
};
const SESSION_VALUES = {
  label: { pesan: 'message', foto: 'photo' },
  status: { teks: 'captions' },
  upload: {
    olah: 'processing',
    antre: 'queued',
    menunggu: 'waiting',
    terkirim: 'sent',
    hilang: 'missing',
    'server-lama': 'old-server',
    gagal: 'failed',
  },
  captionStatus: { proses: 'processing', selesai: 'done', gagal: 'failed' },
};
const CAPTION_KEYS = { judul: 'title' };
const QUEUE_KEYS = {
  jenis: 'kind',
  kode: 'code',
  satuan: 'singles',
  satuanTerkirim: 'singlesSent',
  hasilTerkirim: 'resultSent',
  coba: 'attempts',
  berikut: 'nextTry',
  dibuat: 'created',
  posterTerkirim: 'posterSent',
  bagian: 'parts',
  terkirim: 'sent',
};
const QUEUE_VALUES = { label: { pesan: 'message' } };
// Folders and files in the data folder: [old, new] (relative to the data folder)
const RENAMES = [
  ['catatan', 'logs'],
  ['kapsi', 'captions'],
  ['qr-satuan', 'qr-singles'],
  ['sony-sementara', 'sony-temp'],
  ['antrean-unggah.json', 'upload-queue.json'],
  [path.join('filter', 'daftar.json'), path.join('filter', 'filters.json')],
];

/* ---------- Small helpers ---------- */
const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
// Rename keys in one object. If the old and the new name are both there, the old one wins:
// that only happens when an older Leura version was used again after this one, and the
// older version then saved the most recent value under the old name.
function renameKeys(obj, map) {
  if (!isObject(obj)) return false;
  let changed = false;
  for (const [from, to] of Object.entries(map)) {
    if (!(from in obj)) continue;
    obj[to] = obj[from];
    delete obj[from];
    changed = true;
  }
  return changed;
}
function renameValues(obj, valueMaps) {
  if (!isObject(obj)) return false;
  let changed = false;
  for (const [key, map] of Object.entries(valueMaps)) {
    if (typeof obj[key] === 'string' && Object.hasOwn(map, obj[key])) {
      obj[key] = map[obj[key]];
      changed = true;
    }
  }
  return changed;
}

/* ---------- One migration run ---------- */
function run({ dataDir = userData } = {}) {
  const notes = []; // lines for the app log (written by main.js once the log is ready)
  let backupDir = null;
  // Copy a file to the backup folder (once per run) before it is changed or moved
  const backup = rel => {
    const from = path.join(dataDir, rel);
    if (!fs.existsSync(from)) return;
    if (!backupDir) backupDir = path.join(dataDir, 'backup', 'before-english-data-' + stamp());
    const to = path.join(backupDir, rel);
    if (fs.existsSync(to)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  };
  // Save a changed JSON file the safe way, and refresh its .bak so it has the new names too
  const save = (rel, data) => {
    const p = path.join(dataDir, rel);
    writeJSON(p, data);
    try {
      fs.copyFileSync(p, p + '.bak');
    } catch {
      /* the .bak copy is only a fallback; the main file is already saved */
    }
  };
  const step = (name, fn) => {
    try {
      const n = fn();
      if (n) notes.push({ level: 'info', text: `Data update: ${name} (${n})` });
    } catch (e) {
      notes.push({ level: 'error', text: `Data update failed: ${name}: ${e.message} (tried again next time)` });
    }
  };

  // 1. Folders and files that have a new name
  step('renamed folders/files', () => {
    let n = 0;
    for (const [from, to] of RENAMES) {
      const a = path.join(dataDir, from),
        b = path.join(dataDir, to);
      if (!fs.existsSync(a)) continue;
      if (fs.statSync(a).isFile()) {
        backup(from);
        if (fs.existsSync(b)) {
          // both exist: an older version was used again; the new file is kept, the old one stays in the backup
          moveToBackup(a, from);
        } else fs.renameSync(a, b);
        for (const extra of ['.bak', '.tmp']) if (fs.existsSync(a + extra)) moveToBackup(a + extra, from + extra);
      } else if (!fs.existsSync(b)) fs.renameSync(a, b);
      else {
        // both folders exist: move what isn't in the new folder yet
        for (const f of fs.readdirSync(a))
          if (!fs.existsSync(path.join(b, f))) fs.renameSync(path.join(a, f), path.join(b, f));
        if (!fs.readdirSync(a).length) fs.rmdirSync(a);
      }
      n++;
    }
    return n;
  });
  function moveToBackup(abs, rel) {
    if (!backupDir) backupDir = path.join(dataDir, 'backup', 'before-english-data-' + stamp());
    const to = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (fs.existsSync(to)) fs.unlinkSync(abs);
    else fs.renameSync(abs, to);
  }

  // 2. settings.json
  step('settings', () => {
    const s = readJSON(path.join(dataDir, 'settings.json'), null);
    if (!isObject(s)) return 0;
    const changed = [renameKeys(s, SETTINGS_KEYS), renameKeys(s.upload, UPLOAD_SETTINGS_KEYS)].some(Boolean);
    if (!changed) return 0;
    backup('settings.json');
    save('settings.json', s);
    return 1;
  });

  // 3. couples.json (main-page menu per couple)
  step('couples', () => {
    const d = readJSON(path.join(dataDir, 'couples.json'), null);
    if (!isObject(d) || !Array.isArray(d.couples)) return 0;
    let n = 0;
    for (const c of d.couples) if (isObject(c) && renameKeys(c.menu, MENU_KEYS)) n++;
    if (!n) return 0;
    backup('couples.json');
    save('couples.json', d);
    return n;
  });

  // 4. templates/<id>/template.json + background/frame images
  step('templates', () => {
    const dir = path.join(dataDir, 'templates');
    if (!fs.existsSync(dir)) return 0;
    let n = 0;
    for (const id of fs.readdirSync(dir)) {
      const rel = path.join('templates', id, 'template.json');
      const t = readJSON(path.join(dataDir, rel), null);
      let changed = false;
      if (isObject(t)) {
        changed = renameKeys(t, TEMPLATE_KEYS);
        if (Object.hasOwn(TEMPLATE_SIZES, t.size)) {
          t.size = TEMPLATE_SIZES[t.size];
          changed = true;
        }
        if (changed) {
          backup(rel);
          save(rel, t);
        }
      }
      for (const [from, to] of Object.entries(TEMPLATE_IMAGES))
        for (const ext of ['png', 'jpg']) {
          const a = path.join(dir, id, `${from}.${ext}`);
          if (!fs.existsSync(a)) continue;
          const b = path.join(dir, id, `${to}.${ext}`);
          if (fs.existsSync(b)) moveToBackup(a, path.join('templates', id, `${from}.${ext}`));
          else fs.renameSync(a, b);
          changed = true;
        }
      if (changed) n++;
    }
    return n;
  });

  // 5. filter/filters.json (photo filter collection)
  step('filters', () => {
    const rel = path.join('filter', 'filters.json');
    const d = readJSON(path.join(dataDir, rel), null);
    if (!Array.isArray(d)) return 0;
    let n = 0;
    for (const x of d) if (renameKeys(x, FILTER_KEYS)) n++;
    if (!n) return 0;
    backup(rel);
    save(rel, d);
    return n;
  });

  // 6. sessions.json (session history)
  step('sessions', () => {
    const list = readJSON(path.join(dataDir, 'sessions.json'), null);
    if (!Array.isArray(list)) return 0;
    let n = 0;
    for (const s of list) {
      if (!isObject(s)) continue;
      let changed = renameKeys(s, SESSION_KEYS);
      if (renameValues(s, SESSION_VALUES)) changed = true;
      if (Array.isArray(s.captions)) for (const k of s.captions) if (renameKeys(k, CAPTION_KEYS)) changed = true;
      if (changed) n++;
    }
    if (!n) return 0;
    backup('sessions.json');
    save('sessions.json', list);
    return n;
  });

  // 7. upload-queue.json (QR uploads not sent yet)
  step('QR upload queue', () => {
    const queue = readJSON(path.join(dataDir, 'upload-queue.json'), null);
    if (!Array.isArray(queue)) return 0;
    const oldSingles = path.join(dataDir, 'qr-satuan') + path.sep,
      newSingles = path.join(dataDir, 'qr-singles') + path.sep;
    let n = 0;
    for (const x of queue) {
      if (!isObject(x)) continue;
      let changed = renameKeys(x, QUEUE_KEYS);
      if (renameValues(x, QUEUE_VALUES)) changed = true;
      if (Array.isArray(x.singles))
        x.singles = x.singles.map(f => {
          if (typeof f !== 'string' || !f.startsWith(oldSingles)) return f;
          changed = true;
          return newSingles + f.slice(oldSingles.length);
        });
      if (changed) n++;
    }
    if (!n) return 0;
    backup('upload-queue.json');
    save('upload-queue.json', queue);
    return n;
  });

  // 8. Leftover temporary chapter files from the old caption step (made again when needed)
  step('old temporary files', () => {
    const dir = path.join(dataDir, 'captions');
    if (!fs.existsSync(dir)) return 0;
    const old = fs.readdirSync(dir).filter(f => f.endsWith('-bab.txt'));
    old.forEach(f => fs.unlinkSync(path.join(dir, f)));
    return old.length;
  });

  // 9. settings, couples, session history and QR upload queue → database (Leura 1.4.0)
  step('moved into the database', () => moveIntoDatabase(dataDir, notes));

  if (backupDir)
    notes.unshift({ level: 'info', text: 'Data from an older version updated; old files kept in ' + backupDir });
  return notes;
}

/* ---------- JSON files → database ---------- */
const DATA_FILES = ['settings.json', 'couples.json', 'sessions.json', 'upload-queue.json'];

function moveIntoDatabase(dataDir, notes) {
  const store = openDatabase(dataDir);
  const firstTime = !store.getState('movedFromJson', null);
  const has = f => [f, f + '.bak'].some(x => fs.existsSync(path.join(dataDir, x)));
  const present = DATA_FILES.filter(has);
  // Session history of very old versions lived in the recordings folder (only taken over once)
  const veryOld = path.join(defaultDir, 'sessions.json');
  const takeVeryOld = firstTime && !present.includes('sessions.json') && fs.existsSync(veryOld);
  if (!present.length && !takeVeryOld) {
    if (firstTime) store.setState('movedFromJson', new Date().toISOString());
    return 0;
  }
  const read = f => (present.includes(f) ? readJSON(path.join(dataDir, f), null) : null);
  const settings = read('settings.json');
  const couples = read('couples.json');
  const sessions = takeVeryOld
    ? (readJSON(veryOld, null) || []).map(x => (isObject(x) ? { ...x, dir: x.dir || defaultDir } : x))
    : read('sessions.json');
  const queue = read('upload-queue.json');

  let n = 0;
  store.transaction(() => {
    if (firstTime) {
      if (isObject(settings)) {
        store.writeSettings(settings);
        n++;
      }
      if (isObject(couples) && Array.isArray(couples.couples) && couples.couples.length) {
        store.writeCouples({ activeId: couples.activeId, couples: couples.couples.filter(isObject) });
        n++;
      }
    } else if (settings || couples) {
      // An older Leura version was opened again after this one and saved its own files.
      // The database has the real data: keep it; the files stay in the backup.
      notes.push({
        level: 'warn',
        text: 'Settings/couples saved by an older Leura version were not taken over (the database is kept); the files are in the backup folder',
      });
    }
    if (Array.isArray(sessions)) {
      const used = new Set(store.readSessions().map(x => x.id));
      let nextId = Math.max(Date.now() * 1000, ...used) + 1;
      for (const x of sessions) {
        if (!isObject(x)) continue;
        if (!firstTime && used.has(x.id)) continue; // already in the database
        let id = Number.isSafeInteger(x.id) ? x.id : Date.parse(x.time) || 0;
        if (!Number.isSafeInteger(id) || id <= 0 || used.has(id)) id = nextId++; // missing or double id
        store.saveSession({ ...x, id });
        used.add(id);
        n++;
      }
    }
    if (Array.isArray(queue)) {
      const current = store.readUploadQueue();
      const codes = new Set(current.map(x => x.code));
      const added = queue.filter(x => isObject(x) && !(x.code && codes.has(x.code)));
      if (added.length) store.writeUploadQueue([...current, ...added]);
      n += added.length;
    }
    store.setState('movedFromJson', store.getState('movedFromJson', null) || new Date().toISOString());
  });

  // Only after the database has everything: move the files out of the way (never deleted)
  const dir = path.join(dataDir, 'backup', 'before-database-' + stamp());
  for (const f of DATA_FILES)
    for (const extra of ['', '.bak', '.tmp']) {
      const from = path.join(dataDir, f + extra);
      if (!fs.existsSync(from)) continue;
      fs.mkdirSync(dir, { recursive: true });
      fs.renameSync(from, path.join(dir, f + extra));
    }
  if (takeVeryOld) {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(veryOld, path.join(dir, 'sessions-from-recordings-folder.json'));
  }
  if (fs.existsSync(dir))
    notes.push({ level: 'info', text: 'Data moved into the database; the JSON files are kept in ' + dir });
  return n;
}

module.exports = { run };
