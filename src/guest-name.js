/* =====================================================================
   guest-name.js — the "What's your name?" page after the guest presses Start.
   The guest name is used in the recording & photo file names in the couple
   folder (e.g. "Budi_pesan.mp4", "Budi_hasil.jpg"). Can be turned off in
   Admin → Display → "Ask guest name". The on-screen keyboard is keyboard.js.
   ===================================================================== */
import { setNotice, show } from './app.js';
import { diskFullNotice, diskIsFull } from './disk-space.js';
import { $, state } from './state.js';
import { onLanguageChange, t } from './language.js';
import { createKeyboard } from './keyboard.js';

let nameKeyboard = null;

// Start button: to the name page (if turned on), or straight to the main menu
export function startGuest() {
  if (diskIsFull()) return setNotice(diskFullNotice(), 15000);
  state.guestName = '';
  if (!state.cfg.askName) return show('utama');
  $('namaInput').value = '';
  if (nameKeyboard) nameKeyboard.reset();
  show('nama');
  setTimeout(() => $('namaInput').focus({ preventScroll: true }), 50);
}
function submitName() {
  const n = $('namaInput').value.replace(/\s+/g, ' ').trim();
  if (!n) return;
  state.guestName = n;
  renderGreeting();
  show('utama');
}
// "Hi, Budi!" on the main menu
export function renderGreeting() {
  const el = $('sapaTamu');
  el.textContent = state.guestName ? t('nama.hai', { name: state.guestName }) : '';
  el.style.display = state.guestName ? '' : 'none';
}

// Wire up this feature's buttons (called once from start.js)
export function setupGuestName() {
  nameKeyboard = createKeyboard($('namaKeyboard'), $('namaInput'), { onEnter: submitName, maxLength: 40 });
  onLanguageChange(() => nameKeyboard.redraw()); // key labels follow the guest screen language
  $('btnNamaBack').onclick = () => show('start');
}
