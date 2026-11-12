/* =====================================================================
   filter.js — collection of photo filters (3D LUT .cube) for templates
   Stored in <data folder>/filter/:
     filters.json     [{ id, name, size, created }]
     <id>.cube        the original .cube file uploaded by the admin
   Admin → Edit template → Filter tab: upload a .cube, choose the filter for
   that template, set its strength. Guest photos use the template's filter.
   ===================================================================== */
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { userData, readJSON, writeJSON } = require('./storage');
const { parseCube } = require('../src/lut.js'); // ES module (require(esm), Node 22.12+ / Electron 45)
const log = require('./log');

const FILTER_DIR = path.join(userData, 'filter');
const listFile = path.join(FILTER_DIR, 'filters.json');
const MAX_BYTES = 20 * 1024 * 1024; // a 65³ .cube is ±9 MB; limit 20 MB
const MAX_FILTERS = 50;

const safeId = id =>
  String(id || '')
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(0, 40);
const listFilters = () => {
  const d = readJSON(listFile, []);
  return Array.isArray(d)
    ? d.filter(x => x && x.id && fs.existsSync(path.join(FILTER_DIR, safeId(x.id) + '.cube')))
    : [];
};
const saveList = d => {
  fs.mkdirSync(FILTER_DIR, { recursive: true });
  writeJSON(listFile, d);
};
// eslint-disable-next-line no-control-regex -- on purpose: looks for control characters (removed from filter names)
const CONTROL_CHARS = /[\u0000-\u001f]/g;
const cleanName = (name, fallback) =>
  String(name || '')
    .replace(/\.cube$/i, '')
    .replace(CONTROL_CHARS, '')
    .trim()
    .slice(0, 40) || fallback;

function addFilter(name, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!b.length) return { error: 'The filter file is empty.' };
  if (b.length > MAX_BYTES) return { error: 'The filter file is too large (max 20 MB).' };
  const d = listFilters();
  if (d.length >= MAX_FILTERS) return { error: `You already have ${MAX_FILTERS} filters. Delete unused ones first.` };
  const text = Buffer.from(b).toString('utf8');
  let lut;
  try {
    lut = parseCube(text);
  } catch (e) {
    return { error: "This file can't be used: " + e.message };
  }
  const id = 'lut' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const item = {
    id,
    name: cleanName(name, lut.title || 'Filter ' + (d.length + 1)),
    size: lut.size,
    created: Date.now(),
  };
  fs.mkdirSync(FILTER_DIR, { recursive: true });
  fs.writeFileSync(path.join(FILTER_DIR, id + '.cube'), text);
  d.push(item);
  saveList(d);
  log.write(`Filter added: "${item.name}" (LUT ${lut.size}³)`);
  return { ok: true, filter: item, list: d };
}

function register() {
  ipcMain.handle('list-filters', () => listFilters());
  ipcMain.handle('add-filter', (e, name, bytes) => {
    try {
      return addFilter(name, bytes);
    } catch (err) {
      return { error: err.message };
    }
  });
  // Contents of the .cube file (parsed in the UI with parseCube)
  ipcMain.handle('get-filter', (e, id) => {
    const clean = safeId(id),
      item = listFilters().find(x => x.id === clean);
    if (!item) return null;
    try {
      return { ...item, text: fs.readFileSync(path.join(FILTER_DIR, clean + '.cube'), 'utf8') };
    } catch {
      return null;
    }
  });
  ipcMain.handle('rename-filter', (e, id, name) => {
    const d = listFilters(),
      item = d.find(x => x.id === safeId(id));
    if (!item) return { error: 'Filter not found.' };
    item.name = cleanName(name, item.name);
    saveList(d);
    return { ok: true, list: d };
  });
  // Remove from the collection. Templates that use it automatically go back to no filter.
  ipcMain.handle('delete-filter', (e, id) => {
    const clean = safeId(id),
      d = listFilters(),
      item = d.find(x => x.id === clean);
    if (!item) return { error: 'Filter not found.' };
    try {
      fs.unlinkSync(path.join(FILTER_DIR, clean + '.cube'));
    } catch {
      /* the .cube file is already gone */
    }
    const rest = d.filter(x => x.id !== clean);
    saveList(rest);
    log.write(`Filter deleted: "${item.name}"`);
    return { ok: true, list: rest };
  });
}

module.exports = { register, listFilters, FILTER_DIR };
