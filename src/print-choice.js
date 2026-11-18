/* =====================================================================
   print-choice.js — "How many prints?" page (printCopies), between
   Edit photo → Done and the Thank you page. Only when printing is on
   (Admin → Photo booth settings → Printing).
   - The guest sees their finished photo and picks a number with − / +
     (1 up to the limit from Admin), then Print, or "No prints".
   - The photo is already being saved in the background meanwhile, so the
     QR on the print can carry its download link (photobooth.js).
   - A guest who walks away: after a while the chosen number is printed
     anyway (app.js → idle timer calls choosePrintsByItself).
   - The print image = the digital photo + the print-only QR from the
     template (tpl.qr), sent to main/print.js.
   ===================================================================== */
import { drawPrintQr } from './template-render.js';
import { language, onLanguageChange, t } from './language.js';
import { $, state, sleep } from './state.js';
import { show } from './app.js';

const LEAVE_MS = 460; // styles/photobooth.css → pcOut
const MAX = 10;

export const printOn = () => !!(state.cfg && state.cfg.printEnabled);
const limit = () => Math.max(1, Math.min(MAX, Number(state.cfg && state.cfg.printMaxCopies) || 4));

let choice = null; // { resolve, copies, kind }

// What the template is printed as on 4×6 paper (main/print.js)
export function printLayout(lay) {
  if (lay.W * 2.5 <= lay.H) return 'strip';
  if (lay.W === lay.H) return 'square';
  return lay.W > lay.H ? 'landscape' : 'portrait';
}

function render() {
  if (!choice) return;
  const n = choice.copies;
  $('pcCount').textContent = String(n);
  $('pcUnit').textContent = t((choice.kind === 'strip' ? 'pc.strip.' : 'pc.unit.') + (n === 1 ? 'one' : 'other'));
  $('pcMinus').disabled = n <= 1;
  $('pcPlus').disabled = n >= limit();
}
function bump(step) {
  if (!choice) return;
  const next = Math.max(1, Math.min(limit(), choice.copies + step));
  if (next === choice.copies) return;
  choice.copies = next;
  render();
  // The number rolls softly in the direction it changed
  const el = $('pcCount');
  el.classList.remove('up', 'down');
  void el.offsetWidth;
  el.classList.add(step > 0 ? 'up' : 'down');
}

/* Show the page and wait for the guest. Resolves with the number of prints (0 = no prints). */
export function askPrintCopies(photoUrl, kind) {
  if (choice) choice.resolve(0);
  return new Promise(resolve => {
    choice = { resolve, copies: 1, kind };
    $('pcPhoto').src = photoUrl;
    $('printCopies').classList.remove('leaving');
    $('printCopies').classList.toggle('pc-strip', kind === 'strip');
    $('printCopies').classList.toggle('pc-landscape', kind === 'landscape');
    render();
    show('printCopies');
  });
}
// Leave with an animation (the photo slides down, as if into the printer), then answer
async function finish(copies) {
  if (!choice || $('printCopies').classList.contains('leaving')) return;
  const { resolve } = choice;
  $('printCopies').classList.add('leaving', copies ? 'to-print' : 'no-print');
  await sleep(LEAVE_MS);
  choice = null;
  $('printCopies').classList.remove('to-print', 'no-print');
  resolve(copies);
}
// Idle on this page: print the number that is chosen (the default is 1)
export function choosePrintsByItself() {
  if (choice) finish(choice.copies);
}

/* The print image: the finished photo + the QR (only on the print). `link` = the photo's download link
   from savePhotos; no link (QR download off, or saving failed) = printed without a QR. */
export function printCanvas(out, lay, link) {
  const c = document.createElement('canvas');
  c.width = out.width;
  c.height = out.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(out, 0, 0);
  if (link) drawPrintQr(ctx, printQrSpot(lay), link + (language === 'en' ? '?b=en' : ''));
  return c;
}
// The QR spot of a layout (template or built-in), or undefined when it has none / it is off
export function printQrSpot(lay) {
  const qr = lay.tpl ? lay.prepared.tpl.qr : lay.qr;
  return qr && qr.enabled ? { enabled: true, x: qr.x, y: qr.y, size: qr.size } : undefined;
}

/* Session history → Print: the saved template photo + its QR again (same spot as the guest's print).
   Older sessions without a saved spot are printed without a QR. */
export async function printSession(s, copies, link) {
  const src = await api.printSessionSource(s.id);
  if (!src || src.error) return { ok: false, error: (src && src.error) || 'The photo could not be read.' };
  const bmp = await createImageBitmap(new Blob([src.image], { type: 'image/jpeg' }));
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  if (link) drawPrintQr(ctx, s.printQr, link + (language === 'en' ? '?b=en' : ''));
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
  if (!blob) return { ok: false, error: 'Could not create the print image.' };
  return api.printPhoto({
    image: new Uint8Array(await blob.arrayBuffer()),
    copies,
    layout: printLayout({ W: c.width, H: c.height }),
    guest: s.guest,
    sessionId: s.id,
    couple: s.couple,
  });
}

// Wire up this feature's buttons (called once from start.js)
export function setupPrintChoice() {
  $('pcMinus').onclick = () => bump(-1);
  $('pcPlus').onclick = () => bump(1);
  $('pcPrint').onclick = () => choice && finish(choice.copies);
  $('pcSkip').onclick = () => finish(0);
  onLanguageChange(render);
}
