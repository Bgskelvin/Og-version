/* =====================================================================
   app.js — moving between pages, going back automatically when idle,
   notices and short form messages
   ===================================================================== */
import { renderGreeting, startGuest } from './guest-name.js';
import { $, SCREENS, state } from './state.js';
import { setTemplateCoupleName } from './template-render.js';
import { getTemplateCouple } from './template-editor.js';
import { cameraModeForScreen } from './sony-camera.js';

export function show(name) {
  state.current = name;
  if (name === 'start') {
    state.guestName = '';
    state.guestActivity = 0;
    renderGreeting();
  } // the next guest starts from zero
  if (name === 'thanks') state.guestActivity++;
  if (name === 'utama') $('btnSelesaiTamu').style.display = state.guestActivity ? '' : 'none';
  // {couple} in the template preview = the couple being edited, only while on the couple page/editor.
  // On other pages (including guest photos) it's always the active couple.
  setTemplateCoupleName(
    ['tambah', 'tpleditor'].includes(name) && getTemplateCouple() ? getTemplateCouple().name : null,
  );
  SCREENS.forEach(s => $(s).classList.toggle('on', s === name));
  cameraModeForScreen(name); // Sony camera: video/photo mode to match the page
  document.body.classList.toggle('camOn', ['utama', 'pesan', 'quiz', 'photo'].includes(name));
  resetIdle();
}
export function resetIdle() {
  clearTimeout(state.idleTimer);
  if (state.busy) return;
  const wait = {
    nama: 60000,
    utama: 60000,
    pesan: 60000,
    quiz: 60000,
    photo: 60000,
    editphoto: 180000,
    admin: 180000,
    riwayat: 600000,
    setvideo: 180000,
    setphoto: 180000,
    tpleditor: 900000,
    tambah: 900000,
    thanks: 20000,
  }[state.current];
  // The Thank you page with a QR stays longer so guests have time to scan it
  const delay = state.current === 'thanks' && $('thanksQR') && $('thanksQR').style.display !== 'none' ? 60000 : wait;
  // Thank you → back to the menu (the guest may want another activity); other pages → Start
  if (delay) state.idleTimer = setTimeout(() => show(state.current === 'thanks' ? 'utama' : 'start'), delay);
}
// Short green/red message under a form in Admin; clears itself after 4 seconds
export function flash(id, text, isErr) {
  const el = $(id);
  el.className = 'note ' + (isErr ? 'err' : 'ok');
  el.textContent = text;
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.textContent = '';
  }, 4000);
}
export function setNotice(t, ms) {
  clearTimeout(state.noticeTimer);
  $('notice').textContent = t;
  $('notice').style.display = t ? 'block' : 'none';
  if (t && ms) state.noticeTimer = setTimeout(() => setNotice(''), ms);
}

// Wire up this feature's buttons (called once from start.js)
export function setupNavigation() {
  $('btnStart').onclick = startGuest;
  $('btnCobaLagi').onclick = () => show('utama');
  $('btnSelesaiTamu').onclick = () => show('start');
}
