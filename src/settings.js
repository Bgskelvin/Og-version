/* =====================================================================
   settings.js — the "Display" and "Admin login" groups on the Admin page,
   and applying all settings to the app (applySettings).
   Setting keys (messageCountdown, askName, language, …) come from main/settings.js.
   ===================================================================== */
import { applyCouples } from './couple.js';
import { $, state } from './state.js';
import { language, setLanguage } from './language.js';
import { flash } from './app.js';

const SWATCHES = [
  ['#B08D57', 'Gold'],
  ['#C47A86', 'Rose'],
  ['#7C9A7E', 'Sage'],
  ['#3E6E9E', 'Blue'],
  ['#48484A', 'Graphite'],
];
export const SECONDS = [20, 30, 45, 60, 90, 120, 180];
export const secLabel = v => (v < 60 ? `${v} seconds` : `${v / 60} minute${v === 60 ? '' : 's'}`);
export function fillSelect(sel, values, current, label) {
  sel.innerHTML = '';
  [...new Set([...values, current])]
    .sort((a, b) => a - b)
    .forEach(v => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label(v);
      o.selected = v === current;
      sel.appendChild(o);
    });
}
function renderSwatches(accent) {
  const box = $('swatches');
  box.innerHTML = '';
  const list = SWATCHES.some(([c]) => c.toLowerCase() === accent.toLowerCase())
    ? SWATCHES
    : [...SWATCHES, [accent, 'Current color']];
  list.forEach(([c, name]) => {
    const b = document.createElement('button');
    b.className = 'sw' + (c.toLowerCase() === accent.toLowerCase() ? ' on' : '');
    b.style.background = c;
    b.style.setProperty('--c', c);
    b.title = name;
    b.setAttribute('aria-label', 'Color ' + name);
    b.onclick = () => saveSetting({ accent: c }, `Color changed to ${name}.`);
    box.appendChild(b);
  });
}
// Default values for settings that are missing
const DEFAULTS = {
  quizSeconds: 60,
  quizRounds: 3,
  messageCountdown: 3,
  messageMaxSeconds: 0,
  photoCountdown: 5,
  photoPreview: 2,
  photoFlash: true,
  enableMessage: true,
  enableQuiz: true,
  enablePhoto: true,
  askName: true,
};
export function normalizeConfig(src) {
  for (const [k, d] of Object.entries(DEFAULTS)) {
    const v = src[k];
    state.cfg[k] =
      typeof d === 'boolean'
        ? typeof v === 'boolean'
          ? v
          : d
        : Number.isFinite(Number(v)) && v !== null && v !== ''
          ? Number(v)
          : d;
  }
}
// The main menu buttons follow the active couple's settings (Admin → couple → Menu)
export function coupleMenu(c = state.activeCouple) {
  return (c && c.menu) || { message: true, quiz: true, photo: true };
}
export function applyMenu() {
  const m = coupleMenu();
  $('btnToMessage').style.display = m.message ? '' : 'none';
  $('btnToQuiz').style.display = m.quiz && state.cfg.quiz && state.cfg.quiz.length ? '' : 'none';
  $('btnToPhoto').style.display = m.photo ? '' : 'none';
}
// Apply the latest settings to the app without restarting it
export function applySettings(s) {
  normalizeConfig(s);
  if (s.camera) state.cfg.camera = s.camera;
  if (s.language && s.language !== language) {
    state.cfg.language = s.language;
    setLanguage(s.language);
    if (state.couplesData) applyCouples(state.couplesData); // welcome text & questions follow the new language
  }
  applyMenu();
  if (s.accent) document.documentElement.style.setProperty('--accent', s.accent);
}
export async function loadSettings() {
  const s = await api.getSettings();
  applySettings(s);
  renderSwatches(s.accent);
  $('setKiosk').checked = s.kiosk;
  $('setAskName').checked = state.cfg.askName;
  $('setGuestLanguage').value = s.language || 'en';
  $('setId').value = s.loginId;
  $('setOld').value = $('setNew').value = $('setNew2').value = '';
}
// Settings are saved and applied right away, without closing the app
async function saveSetting(patch, msg) {
  const s = await api.saveSettings(patch);
  applySettings(s);
  renderSwatches(s.accent);
  $('setKiosk').checked = s.kiosk;
  $('setAskName').checked = state.cfg.askName;
  flash('setMsg', msg || 'Saved.');
}
async function saveLogin() {
  if (!$('setOld').value) return flash('loginMsg', 'Enter your current password first.', true);
  if ($('setNew').value !== $('setNew2').value) return flash('loginMsg', 'The new passwords do not match.', true);
  const r = await api.changeLogin($('setOld').value, $('setId').value, $('setNew').value);
  if (r.error) return flash('loginMsg', r.error, true);
  $('setOld').value = $('setNew').value = $('setNew2').value = '';
  flash('loginMsg', `Login changed. Next time, sign in with ID "${r.id}" and the new password.`);
}

// Wire up this feature's buttons (called once from start.js)
export function setupSettings() {
  $('setKiosk').onchange = e =>
    saveSetting(
      { kiosk: e.target.checked },
      e.target.checked ? 'Full screen is on. To leave it, turn it off here.' : 'Full screen is off.',
    );
  $('setGuestLanguage').onchange = e =>
    saveSetting(
      { language: e.target.value },
      e.target.value === 'en' ? 'Guest screens are now in English.' : 'Guest screens are now in Indonesian.',
    );
  $('setAskName').onchange = e =>
    saveSetting(
      { askName: e.target.checked },
      e.target.checked
        ? 'Guests will be asked to type their name after pressing Start.'
        : 'Guests go straight to the main menu without typing a name.',
    );
  $('btnSaveLogin').onclick = saveLogin;
}
