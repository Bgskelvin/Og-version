/* =====================================================================
   couple.js — data couple (couples.json) dan couple aktif
   ===================================================================== */
const { ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  config,
  userData,
  readJSON,
  writeJSON,
  readSettings,
  getOutDir,
  usableDir,
  coupleDir,
} = require('./penyimpanan');
const { hapusTemplateCouple } = require('./template');

/* ---------- Data couple ---------- */
const couplesPath = path.join(userData, 'couples.json');
const MAX_Q = 10;
// ID unik: waktu + acak, supaya dua couple yang dibuat bersamaan tidak pernah sama
const idBaru = () => 'c' + Date.now() + Math.random().toString(36).slice(2, 6);
function readCouples() {
  let d = readJSON(couplesPath, null);
  if (!d || !Array.isArray(d.couples)) {
    // Pertama kali: ambil couple dari config.json sebagai data awal
    const first = {
      id: idBaru(),
      name: config.couple || 'Couple Baru',
      welcome: config.welcome || '',
      questions: (config.quiz || []).slice(0, MAX_Q),
    };
    d = { activeId: first.id, couples: [first] };
    writeCouples(d);
  }
  d.couples.forEach(c => {
    c.menu = bersihkanMenu(c.menu);
  });
  if (!d.couples.find(c => c.id === d.activeId)) d.activeId = d.couples[0] ? d.couples[0].id : null;
  return d;
}
function writeCouples(d) {
  writeJSON(couplesPath, d);
}

/* Menu di Halaman Utama, diatur per couple. Couple lama yang belum punya
   pengaturan ini memakai pengaturan menu lama (dulu berlaku untuk semua couple). */
const MENU = { pesan: 'Send a message', quiz: 'Quick quiz', photo: 'Photo booth' };
function menuBawaan() {
  const s = readSettings();
  return { pesan: s.enablePesan !== false, quiz: s.enableQuiz !== false, photo: s.enablePhoto !== false };
}
function bersihkanMenu(m) {
  const awal = menuBawaan();
  if (!m || typeof m !== 'object') return awal;
  const out = {};
  for (const k of Object.keys(MENU)) out[k] = typeof m[k] === 'boolean' ? m[k] : awal[k];
  return out;
}
function cleanCouple(c) {
  return {
    menu: bersihkanMenu(c.menu),
    id: c.id || idBaru(),
    name: String(c.name || '')
      .trim()
      .slice(0, 80),
    welcome: String(c.welcome || '')
      .trim()
      .slice(0, 160),
    questions: (Array.isArray(c.questions) ? c.questions : [])
      .map(q =>
        String(q || '')
          .trim()
          .slice(0, 200),
      )
      .filter(Boolean)
      .slice(0, MAX_Q),
  };
}

function activeCoupleName() {
  const d = readCouples();
  const c = d.couples.find(x => x.id === d.activeId);
  return c ? c.name : '';
}

function daftarkan() {
  ipcMain.handle('get-couples', () => readCouples());
  ipcMain.handle('save-couple', (e, input) => {
    const c = cleanCouple(input || {});
    if (!c.name) return { error: "Please enter the couple's name." };
    if (!Object.values(c.menu).some(Boolean))
      return { error: 'At least one option must be on: Send a message, Quick quiz or Photo booth.' };
    if (c.menu.quiz && !c.questions.length)
      return { error: 'Quick quiz is on: add at least 1 question, or turn Quick quiz off.' };
    const d = readCouples();
    const i = d.couples.findIndex(x => x.id === c.id);
    if (i >= 0) d.couples[i] = c;
    else d.couples.push(c);
    if (!d.activeId) d.activeId = c.id;
    writeCouples(d);
    return { ok: true, couple: c, data: d };
  });
  ipcMain.handle('delete-couple', (e, id) => {
    const d = readCouples();
    if (d.couples.length <= 1) return { error: 'There must be at least 1 couple.' };
    d.couples = d.couples.filter(c => c.id !== id);
    if (d.activeId === id) d.activeId = d.couples[0].id;
    writeCouples(d);
    const templateDihapus = hapusTemplateCouple(id); // template couple ini ikut dihapus (rekaman & foto tetap)
    return { ok: true, data: d, templateDihapus };
  });
  ipcMain.handle('set-active-couple', (e, id) => {
    const d = readCouples();
    if (!d.couples.find(c => c.id === id)) return { error: 'Couple not found.' };
    d.activeId = id;
    writeCouples(d);
    require('./catatan').catat('Couple aktif: ' + d.couples.find(c => c.id === id).name);
    return { ok: true, data: d };
  });
  // id kosong = couple aktif
  ipcMain.handle('open-couple-folder', (e, id) => {
    const data = readCouples();
    const c = data.couples.find(x => x.id === id);
    const nama = c ? c.name : activeCoupleName();
    const d = coupleDir(getOutDir(), nama);
    if (!fs.existsSync(d)) return 'No recordings or photos for this couple yet.';
    if (!usableDir(d)) return 'Folder not available';
    return shell.openPath(d);
  });
}

module.exports = { readCouples, activeCoupleName, daftarkan };
