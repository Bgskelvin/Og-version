/* =====================================================================
   jendela-aktif.js — menyimpan jendela aplikasi yang sedang terbuka,
   supaya modul lain (pengaturan, rekaman) bisa memakainya
   ===================================================================== */
let win = null;
module.exports = {
  getWin: () => (win && !win.isDestroyed() ? win : null),
  setWin: w => { win = w; }
};
