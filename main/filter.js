/* =====================================================================
   filter.js — koleksi filter foto (LUT 3D .cube) untuk template
   Disimpan di <folder data>/filter/:
     daftar.json      [{ id, nama, size, dibuat }]
     <id>.cube        file .cube asli yang diunggah admin
   Admin → Edit template → tab Filter: unggah .cube, pilih filter untuk
   template itu, atur kekuatannya. Foto tamu memakai filter template.
   ===================================================================== */
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { userData, readJSON, writeJSON } = require('./penyimpanan');
const { bacaCube } = require('../src/lut');
const catatan = require('./catatan');

const folderFilter = path.join(userData, 'filter');
const fileDaftar = path.join(folderFilter, 'daftar.json');
const MAKS_BYTE = 20 * 1024 * 1024;          // .cube 65³ ±9 MB; batas 20 MB
const MAKS_FILTER = 50;

const idAman = id => String(id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
const daftar = () => {
  const d = readJSON(fileDaftar, []);
  return Array.isArray(d) ? d.filter(x => x && x.id && fs.existsSync(path.join(folderFilter, idAman(x.id) + '.cube'))) : [];
};
const simpanDaftar = d => { fs.mkdirSync(folderFilter, { recursive: true }); writeJSON(fileDaftar, d); };
const namaBersih = (nama, cadangan) => String(nama || '').replace(/\.cube$/i, '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || cadangan;

function tambah(nama, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!b.length) return { error: 'File filter kosong.' };
  if (b.length > MAKS_BYTE) return { error: 'File filter terlalu besar (maksimal 20 MB).' };
  const d = daftar();
  if (d.length >= MAKS_FILTER) return { error: `Sudah ada ${MAKS_FILTER} filter. Hapus yang tidak dipakai dulu.` };
  const teks = Buffer.from(b).toString('utf8');
  let lut;
  try { lut = bacaCube(teks); } catch (e) { return { error: 'File tidak bisa dipakai: ' + e.message }; }
  const id = 'lut' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const item = { id, nama: namaBersih(nama, lut.judul || 'Filter ' + (d.length + 1)), size: lut.size, dibuat: Date.now() };
  fs.mkdirSync(folderFilter, { recursive: true });
  fs.writeFileSync(path.join(folderFilter, id + '.cube'), teks);
  d.push(item); simpanDaftar(d);
  catatan.catat(`Filter ditambah: "${item.nama}" (LUT ${lut.size}³)`);
  return { ok: true, filter: item, daftar: d };
}

function daftarkan() {
  ipcMain.handle('filter-daftar', () => daftar());
  ipcMain.handle('filter-tambah', (e, nama, bytes) => {
    try { return tambah(nama, bytes); } catch (err) { return { error: err.message }; }
  });
  // Isi file .cube (diurai di tampilan dengan bacaCube)
  ipcMain.handle('filter-isi', (e, id) => {
    const bersih = idAman(id), item = daftar().find(x => x.id === bersih);
    if (!item) return null;
    try { return { ...item, teks: fs.readFileSync(path.join(folderFilter, bersih + '.cube'), 'utf8') }; } catch (err) { return null; }
  });
  ipcMain.handle('filter-ganti-nama', (e, id, nama) => {
    const d = daftar(), item = d.find(x => x.id === idAman(id));
    if (!item) return { error: 'Filter tidak ditemukan.' };
    item.nama = namaBersih(nama, item.nama); simpanDaftar(d);
    return { ok: true, daftar: d };
  });
  // Hapus dari koleksi. Template yang memakainya otomatis kembali tanpa filter.
  ipcMain.handle('filter-hapus', (e, id) => {
    const bersih = idAman(id), d = daftar(), item = d.find(x => x.id === bersih);
    if (!item) return { error: 'Filter tidak ditemukan.' };
    try { fs.unlinkSync(path.join(folderFilter, bersih + '.cube')); } catch (err) {}
    const sisa = d.filter(x => x.id !== bersih); simpanDaftar(sisa);
    catatan.catat(`Filter dihapus: "${item.nama}"`);
    return { ok: true, daftar: sisa };
  });
}

module.exports = { daftarkan, daftar, folderFilter };
