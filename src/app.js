/* =====================================================================
   app.js — moving between pages, going back automatically when idle,
   notices and short form messages
   ===================================================================== */
import { renderGreeting, startGuest } from './guest-name.js';
import { $, SCREENS, state } from './state.js';
import { setTemplateCoupleName } from './template-render.js';
import { getTemplateCouple } from './template-editor.js';
import { cameraModeForScreen } from './sony-camera.js';
import { openGuestQr, renderDoneButton } from './guest-qr.js';

// How long the Thank you page stays before going back to the main menu by itself
const THANKS_MS = { video: 4500, photo: 6500, failed: 9000 };
const LEAVE_MS = 520; // length of the "leaving" animation (styles/photobooth.css → thanksOut)
// Guest pages: a guest who walks away from these with results gets their QR before Start comes back
const GUEST_PAGES = ['home', 'message', 'quiz', 'photo', 'editphoto'];

export function show(name) {
  const from = state.current;
  state.current = name;
  clearTimeout(state.thanksTimer);
  $('thanks').classList.remove('leaving');
  if (name === 'start') {
    state.guestName = '';
    state.guestActivity = 0;
    state.guestResults = []; // a new list: a save that finishes late goes to the old guest's list, not this one
    renderGreeting();
  } // the next guest starts from zero
  if (name === 'thanks') {
    state.guestActivity++;
    const page = $('thanks').classList;
    const ms = page.contains('thanks-failed')
      ? THANKS_MS.failed
      : THANKS_MS[page.contains('thanks-photo') ? 'photo' : 'video'];
    $('thanks').style.setProperty('--thanks-ms', ms + 'ms');
    state.thanksTimer = setTimeout(leaveThanks, ms);
  }
  if (name === 'home') {
    $('btnGuestDone').style.display = state.guestActivity ? '' : 'none';
    renderDoneButton();
    // Coming back from Thank you: the menu rises in (styles/photobooth.css → homeIn)
    const home = $('home').classList;
    home.remove('enter');
    if (from === 'thanks') {
      void $('home').offsetWidth; // restart the animation
      home.add('enter');
    }
  }
  // {couple} in the template preview = the couple being edited, only while on the couple page/editor.
  // On other pages (including guest photos) it's always the active couple.
  setTemplateCoupleName(
    ['coupleForm', 'tpleditor'].includes(name) && getTemplateCouple() ? getTemplateCouple().name : null,
  );
  SCREENS.forEach(s => $(s).classList.toggle('on', s === name));
  cameraModeForScreen(name); // Sony camera: video/photo mode to match the page
  document.body.classList.toggle('camOn', ['home', 'message', 'quiz', 'photo'].includes(name));
  resetIdle();
}
export function resetIdle() {
  clearTimeout(state.idleTimer);
  if (state.busy) return;
  const wait = {
    name: 60000,
    home: 60000,
    message: 60000,
    quiz: 60000,
    photo: 60000,
    editphoto: 180000,
    admin: 180000,
    history: 600000,
    setvideo: 180000,
    setphoto: 180000,
    tpleditor: 900000,
    coupleForm: 900000,
    thanks: 20000, // only a safety net: the page leaves by itself after a few seconds
    guestQr: 60000,
  }[state.current];
  if (!wait) return;
  state.idleTimer = setTimeout(() => {
    if (state.current === 'thanks') show('home');
    // The guest left without pressing "Finish & get QR": show their QR anyway before the next guest
    else if (GUEST_PAGES.includes(state.current) && state.guestResults.length) openGuestQr();
    else show('start');
  }, wait);
}
// Thank you → main menu with an animation (by itself after a few seconds, or when the guest taps)
export function leaveThanks() {
  if (state.current !== 'thanks' || $('thanks').classList.contains('leaving')) return;
  clearTimeout(state.thanksTimer);
  $('thanks').classList.add('leaving');
  state.thanksTimer = setTimeout(() => show('home'), LEAVE_MS);
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
  $('thanks').onclick = leaveThanks; // tap anywhere to go back to the menu right away
}
