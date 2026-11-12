/* =====================================================================
   state.js — small helpers and the app state shared across features.
   Every feature imports what it needs from here. All shared, changing
   data lives in the single `state` object, so it's clear what is shared
   and every module can update it (modules can't reassign each other's
   variables).
   ===================================================================== */

// ---------- Small helpers ----------
export const $ = id => document.getElementById(id); // get an element by id
export const sleep = ms => new Promise(r => setTimeout(r, ms)); // wait some milliseconds
export const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; // 75 -> "1:15"
// localStorage with a safety net (it can fail in some conditions)
export const store = {
  get: k => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* browser storage blocked: the choice only lasts until the app is closed */
    }
  },
};

// ---------- Screens ----------
// Every page in index.html (div.screen) must be listed here.
export const SCREENS = [
  'start',
  'nama',
  'utama',
  'pesan',
  'quiz',
  'photo',
  'editphoto',
  'admin',
  'riwayat',
  'setvideo',
  'setphoto',
  'tpleditor',
  'tambah',
  'saving',
  'thanks',
];
export const MAX_Q = 10; // max quiz questions per couple

// ---------- App state ----------
export const state = {
  cfg: null, // settings from the main process (api.getConfig)
  current: 'start', // the page currently shown
  busy: false, // true while recording / shooting: buttons & idle timer locked
  idleTimer: null,
  noticeTimer: null,
  guestActivity: 0, // activities (message/quiz/photo) by this guest; > 0 = Done button shows
  guestName: '', // guest name from the "What's your name?" page (empty = not asked)

  // Camera & mic
  mediaStream: null, // the open camera + mic stream
  noCam: false, // true when there's only a mic (no camera)

  // Video recording
  rec: null, // the recording in progress
  lastSave: Promise.resolve(), // saving of the last recording
  recT0: 0, // recording start time
  recTick: null, // timer for the duration display
  messageLimit: null, // timer for the message length limit (Videobooth settings)
  sessionToken: 0, // increases every time a session ends/aborts, to stop older flows
  cancelTimer: null, // stops the quiz answer timer

  // Couples
  couplesData: null,
  activeCouple: null,
  editingId: null,
  delArmed: null,
};
