/* =====================================================================
   active-window.js — holds the app window that is currently open,
   so other modules (settings, recording) can use it
   ===================================================================== */
let win = null;
module.exports = {
  getWin: () => (win && !win.isDestroyed() ? win : null),
  setWin: w => {
    win = w;
  },
};
