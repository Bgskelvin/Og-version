/* =====================================================================
   guest-qr.js — one QR for everything a guest made (v1.5.0).
   - After a message / quiz / photo is saved, its download code is remembered
     in state.guestResults (no QR on the Thank you page any more).
   - The main menu then shows "Finish & get QR". It opens the Guest QR page:
     one QR that leads to all of this guest's results (main/upload.js →
     guestQr; one result = that result's own page, several = a guest page).
   - A guest who walks away without pressing it still gets the QR: when a
     guest page sits idle, app.js opens this page before going back to Start.
   - QR off in Admin: the button just says "Done" and goes back to Start.
   ===================================================================== */
import { drawQr } from './qr.js';
import { language, onLanguageChange, t } from './language.js';
import { $, state } from './state.js';
import { show } from './app.js';

// Remember a saved result that has its own download code. `results` is the guest's list taken when the
// save started, so a save that finishes late never lands in the NEXT guest's QR.
export function addGuestResult(results, result) {
  if (result && result.code && !results.some(x => x.code === result.code)) results.push(result);
}

// Main menu button: "Finish & get QR" when there's something to download, otherwise "Done"
export function renderDoneButton() {
  const withQr = state.guestResults.length > 0;
  $('guestDoneText').textContent = t(withQr ? 'home.finishQr' : 'home.done');
  $('btnGuestDone').classList.toggle('with-qr', withQr);
}

// "1 video message · 2 photo sessions"
function summary(items) {
  const count = test => items.filter(test).length;
  const parts = [
    ['gq.message', count(x => x.kind === 'video' && x.label !== 'quiz')],
    ['gq.quiz', count(x => x.kind === 'video' && x.label === 'quiz')],
    ['gq.photo', count(x => x.kind === 'photo')],
  ];
  return parts
    .filter(([, n]) => n)
    .map(([key, n]) => t(key + (n === 1 ? '.one' : '.other'), { n }))
    .join(' · ');
}

let opening = false;
export async function openGuestQr() {
  if (opening) return;
  opening = true;
  try {
    const items = state.guestResults;
    const couple = state.activeCouple ? state.activeCouple.name : '';
    const r = items.length ? await api.guestQr(items, couple) : null;
    if (!r || !r.link) {
      show('start'); // QR is off (or nothing to download): the next guest can start
      return;
    }
    const url = r.link + (language === 'en' ? '?b=en' : '');
    drawQr($('qrCanvas'), url, 8);
    $('qrLink').textContent = url.replace(/^https?:\/\//, '');
    $('gqSummary').textContent = summary(items);
    show('guestQr');
  } catch (e) {
    console.log('Guest QR could not be shown: ' + e.message);
    show('start');
  } finally {
    opening = false;
  }
}

// Wire up this feature's buttons (called once from start.js)
export function setupGuestQr() {
  $('btnGuestDone').onclick = () => (state.guestResults.length ? openGuestQr() : show('start'));
  $('btnGuestQrDone').onclick = () => show('start');
  onLanguageChange(renderDoneButton);
}
