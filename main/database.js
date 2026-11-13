/* =====================================================================
   database.js — the Leura database: one SQLite file, <data folder>/leura.db
   (node:sqlite, built into Electron; no extra package).
   Tables:
     settings      Admin settings, one row per setting (value = JSON)
     couples       couples, in the order shown in Admin (data = JSON)
     sessions      session history: one row per recording / photo session, in the
                   order they were made (data = JSON; time, couple, label, status
                   are read from it for searching & sorting)
     upload_queue  QR uploads not sent yet, in order (data = JSON)
     app_state     small values of the app itself (active couple, …)
   Safety:
   - Every change is one transaction: it is saved completely or not at all,
     also when the power goes out halfway (WAL journal + synchronous FULL).
   - Once a day a copy is made in <data folder>/backup/database/ (last 7 days kept).
   - If the file is damaged, it is kept aside as leura.db.corrupt-<time> and the
     newest daily copy is used, so the app always opens.
   - The table layout has a version number (PRAGMA user_version). A later Leura
     version that changes the layout adds a step to SCHEMA; old files are updated
     automatically when they are opened.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const FILE_NAME = 'leura.db';
const KEEP_BACKUPS = 7;

// Each step brings the layout one version up. Never change a step that has been released: add a new one.
const SCHEMA = [
  // 1 — first database version (Leura 1.4.0)
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
   CREATE TABLE couples (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data TEXT NOT NULL) STRICT;
   CREATE TABLE sessions (
     seq INTEGER PRIMARY KEY,
     id INTEGER NOT NULL UNIQUE,
     data TEXT NOT NULL CHECK (json_valid(data)),
     time TEXT GENERATED ALWAYS AS (json_extract(data, '$.time')) VIRTUAL,
     couple TEXT GENERATED ALWAYS AS (json_extract(data, '$.couple')) VIRTUAL,
     label TEXT GENERATED ALWAYS AS (json_extract(data, '$.label')) VIRTUAL,
     status TEXT GENERATED ALWAYS AS (json_extract(data, '$.status')) VIRTUAL
   ) STRICT;
   CREATE INDEX sessions_by_couple ON sessions (couple, time);
   CREATE INDEX sessions_by_status ON sessions (status);
   CREATE TABLE upload_queue (position INTEGER PRIMARY KEY, data TEXT NOT NULL) STRICT;
   CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;`,
];

const pad = n => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Notes for the app log (the log starts after the database is opened; main.js writes them)
const notes = [];
const takeNotes = () => notes.splice(0);

function connect(file) {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
    const check = db.prepare('PRAGMA quick_check').get();
    if (!check || Object.values(check)[0] !== 'ok') throw new Error('database check failed');
    upgrade(db);
    return db;
  } catch (e) {
    try {
      db.close();
    } catch {
      /* already unusable; the caller handles the damaged file */
    }
    throw e;
  }
}

function upgrade(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > SCHEMA.length)
    throw new Error(`database is from a newer Leura (layout ${version}); this version knows up to ${SCHEMA.length}`);
  for (let v = version; v < SCHEMA.length; v++)
    transaction(db, () => {
      db.exec(SCHEMA[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
}

// Run fn as one transaction. Inside another transaction it simply becomes part of that one.
function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* SQLite already rolled back on its own */
    }
    throw e;
  }
}

const backupDir = dataDir => path.join(dataDir, 'backup', 'database');
function backups(dataDir) {
  try {
    return fs
      .readdirSync(backupDir(dataDir))
      .filter(f => /^leura-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
      .map(f => path.join(backupDir(dataDir), f));
  } catch {
    return []; // no backup folder yet
  }
}

// The file is damaged or can't be opened: keep it aside, use the newest daily copy (or start empty)
function recover(file, dataDir, err) {
  const aside = `${file}.corrupt-${Date.now()}`;
  for (const extra of ['', '-wal', '-shm']) if (fs.existsSync(file + extra)) fs.renameSync(file + extra, aside + extra);
  const copies = backups(dataDir);
  for (const copy of copies.reverse()) {
    try {
      fs.copyFileSync(copy, file);
      const db = connect(file);
      notes.push({
        level: 'error',
        text: `Database could not be opened (${err.message}); the copy of ${path.basename(copy)} is used. The damaged file is kept as ${path.basename(aside)}`,
      });
      return db;
    } catch {
      fs.rmSync(file, { force: true }); // this copy is damaged too: try an older one
    }
  }
  notes.push({
    level: 'error',
    text: `Database could not be opened (${err.message}) and there is no usable copy; started empty. The damaged file is kept as ${path.basename(aside)}`,
  });
  return connect(file);
}

/* ---------- One open database per data folder ---------- */
const open = new Map();
function openDatabase(dataDir) {
  if (open.has(dataDir)) return open.get(dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, FILE_NAME);
  let db;
  try {
    db = connect(file);
  } catch (e) {
    if (/newer Leura/.test(e.message)) throw e; // never set aside the data of a newer version
    db = recover(file, dataDir, e);
  }
  const store = makeStore(db, dataDir, file);
  open.set(dataDir, store);
  process.once('exit', () => store.close());
  return store;
}

function makeStore(db, dataDir, file) {
  const q = sql => db.prepare(sql);
  const parse = (text, fallback) => {
    try {
      return JSON.parse(text);
    } catch {
      return fallback; // the CHECK on the table keeps this from happening; never crash on one bad row
    }
  };
  const json = v => JSON.stringify(v === undefined ? null : v);
  const st = {
    settingsAll: q('SELECT key, value FROM settings'),
    settingsClear: q('DELETE FROM settings'),
    settingsPut: q('INSERT INTO settings (key, value) VALUES (?, ?)'),
    couplesAll: q('SELECT data FROM couples ORDER BY position'),
    couplesClear: q('DELETE FROM couples'),
    couplesPut: q('INSERT INTO couples (id, position, data) VALUES (?, ?, ?)'),
    sessionsAll: q('SELECT data FROM sessions ORDER BY seq'),
    sessionsCount: q('SELECT count(*) AS n FROM sessions'),
    sessionGet: q('SELECT data FROM sessions WHERE id = ?'),
    sessionPut: q('INSERT INTO sessions (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data'),
    sessionAdd: q('INSERT OR IGNORE INTO sessions (id, data) VALUES (?, ?)'),
    sessionDelete: q('DELETE FROM sessions WHERE id = ?'),
    sessionIds: q('SELECT id FROM sessions'),
    queueAll: q('SELECT data FROM upload_queue ORDER BY position'),
    queueClear: q('DELETE FROM upload_queue'),
    queuePut: q('INSERT INTO upload_queue (position, data) VALUES (?, ?)'),
    stateGet: q('SELECT value FROM app_state WHERE key = ?'),
    statePut: q(
      'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    ),
    stateDelete: q('DELETE FROM app_state WHERE key = ?'),
  };
  const sessionId = s => {
    if (!s || !Number.isSafeInteger(s.id)) throw new Error('a session needs a whole-number id');
    return s.id;
  };
  let closed = false;

  const store = {
    file,
    transaction: fn => transaction(db, fn),

    /* settings: one plain object */
    readSettings() {
      const out = {};
      for (const r of st.settingsAll.all()) out[r.key] = parse(r.value, null);
      return out;
    },
    writeSettings(s) {
      transaction(db, () => {
        st.settingsClear.run();
        for (const [k, v] of Object.entries(s || {})) if (v !== undefined) st.settingsPut.run(k, json(v));
      });
    },

    /* couples: { activeId, couples: [...] }, or null before the first couple exists */
    readCouples() {
      const couples = st.couplesAll
        .all()
        .map(r => parse(r.data, null))
        .filter(Boolean);
      if (!couples.length) return null;
      return { activeId: store.getState('activeCouple', null), couples };
    },
    writeCouples(d) {
      transaction(db, () => {
        st.couplesClear.run();
        (d.couples || []).forEach((c, i) => st.couplesPut.run(String(c.id), i, json(c)));
        store.setState('activeCouple', d.activeId);
      });
    },

    /* sessions: one row each */
    readSessions: () =>
      st.sessionsAll
        .all()
        .map(r => parse(r.data, null))
        .filter(Boolean),
    countSessions: () => st.sessionsCount.get().n,
    getSession(id) {
      const r = Number.isSafeInteger(id) ? st.sessionGet.get(id) : null;
      return r ? parse(r.data, null) : null;
    },
    // Add a new session or replace the one with the same id
    saveSession: s => st.sessionPut.run(sessionId(s), json(s)),
    // Add only if that id isn't there yet; true if it was added
    addSessionIfNew: s => st.sessionAdd.run(sessionId(s), json(s)).changes > 0,
    // Change some fields of one session (a field set to undefined is removed); false if it doesn't exist
    updateSession(id, patch) {
      return transaction(db, () => {
        const s = store.getSession(id);
        if (!s) return false;
        Object.assign(s, patch);
        st.sessionPut.run(id, json(s));
        return true;
      });
    },
    deleteSession: id => st.sessionDelete.run(id).changes > 0,
    // The whole list at once (sessions not in the list are removed)
    writeSessions(list) {
      transaction(db, () => {
        const keep = new Set();
        for (const s of list) {
          st.sessionPut.run(sessionId(s), json(s));
          keep.add(s.id);
        }
        for (const { id } of st.sessionIds.all()) if (!keep.has(id)) st.sessionDelete.run(id);
      });
    },

    /* upload queue: the whole list in order */
    readUploadQueue: () =>
      st.queueAll
        .all()
        .map(r => parse(r.data, null))
        .filter(Boolean),
    writeUploadQueue(list) {
      transaction(db, () => {
        st.queueClear.run();
        list.forEach((x, i) => st.queuePut.run(i, json(x)));
      });
    },

    /* small app values */
    getState(key, fallback) {
      const r = st.stateGet.get(key);
      return r ? parse(r.value, fallback) : fallback;
    },
    setState(key, value) {
      if (value === undefined || value === null) st.stateDelete.run(key);
      else st.statePut.run(key, json(value));
    },

    // Copy of the whole database for today, if there isn't one yet (last KEEP_BACKUPS days kept)
    dailyBackup() {
      const dir = backupDir(dataDir);
      const target = path.join(dir, `leura-${today()}.db`);
      if (fs.existsSync(target)) return null;
      fs.mkdirSync(dir, { recursive: true });
      const tmp = target + '.tmp';
      fs.rmSync(tmp, { force: true });
      db.prepare('VACUUM INTO ?').run(tmp); // a complete, consistent copy, also while the app is writing
      fs.renameSync(tmp, target);
      for (const old of backups(dataDir).slice(0, -KEEP_BACKUPS)) fs.rmSync(old, { force: true });
      return target;
    },

    close() {
      if (closed) return;
      closed = true;
      open.delete(dataDir);
      try {
        db.close();
      } catch {
        /* already closed */
      }
    },
  };
  return store;
}

module.exports = { openDatabase, takeNotes, FILE_NAME, SCHEMA };
