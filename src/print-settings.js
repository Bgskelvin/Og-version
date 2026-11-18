/* =====================================================================
   print-settings.js — Admin → Photo booth settings → Printing.
   Turn printing on, choose the printer (or "Save as PDF (test)" when
   there is no printer yet), the most prints per guest, a test page,
   and the print queue status (waiting / failed → Retry).
   The queue itself lives in main/print.js.
   ===================================================================== */
import { fillSelect, applySettings } from './settings.js';
import { $, state } from './state.js';
import { flash } from './app.js';

const PDF = ''; // printer value for "Save as PDF (test)"

async function save(patch, msg) {
  const s = await api.saveSettings(patch);
  applySettings(s);
  if (s.error) flash('printMsg', s.error, true);
  else if (msg) flash('printMsg', msg);
  return s;
}

async function fillPrinters(current) {
  const sel = $('setPrinter');
  let list = [];
  try {
    list = (api.printPrinters && (await api.printPrinters())) || [];
  } catch (e) {
    console.warn('Printers could not be listed: ' + e.message);
  }
  sel.innerHTML = '';
  const add = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    o.selected = value === current;
    sel.appendChild(o);
  };
  add(PDF, 'Save as PDF (test, no printer)');
  for (const p of list) add(p.name, p.displayName + (p.isDefault ? ' (default)' : ''));
  // The chosen printer is not connected right now: keep it in the list so it isn't lost
  if (current && !list.some(p => p.name === current)) add(current, current + ' (not found)');
  return list;
}

export function renderPrintStatus(st) {
  if (!st || !$('printStatus')) return;
  const where = st.printer ? st.printer : 'PDF test (no printer)';
  const parts = [`${where}`, `${st.printedToday} printed today`];
  if (st.waiting) parts.push(`${st.waiting} printing`);
  if (st.failed) parts.push(`${st.failed} failed`);
  let text = parts.join(' · ');
  if (st.failed && st.lastError) text += ` — ${st.lastError}`;
  $('printStatus').textContent = text;
  $('printDot').className = 'sony-dot ' + (st.failed ? 'red' : st.waiting ? 'yellow' : 'green');
  $('btnPrintRetry').style.display = st.failed ? '' : 'none';
  $('btnPrintClear').style.display = st.failed ? '' : 'none';
}

export async function fillPrintSettings() {
  if (!api.printStatus) return; // phone demo: no printing
  const s = await api.getSettings();
  $('setPrintEnabled').checked = !!s.printEnabled;
  const max = Number(s.printMaxCopies) || (state.cfg && state.cfg.printMaxCopies) || 4;
  fillSelect($('setPrintMax'), [1, 2, 3, 4, 5, 6, 8, 10], max, v => `${v} print${v === 1 ? '' : 's'}`);
  await fillPrinters(s.printer || PDF);
  renderPrintStatus(await api.printStatus());
}

// Wire up this feature's buttons (called once from start.js)
export function setupPrintSettings() {
  if (!api.printStatus) return;
  $('setPrintEnabled').onchange = e =>
    save(
      { printEnabled: e.target.checked },
      e.target.checked ? 'Printing on: guests choose how many prints after editing.' : 'Printing off.',
    );
  $('setPrinter').onchange = async e => {
    const v = e.target.value;
    await save({ printer: v }, v ? `Printer: ${e.target.selectedOptions[0].textContent}.` : 'Prints are saved as PDF.');
    renderPrintStatus(await api.printStatus());
  };
  $('setPrintMax').onchange = e => {
    const v = Number(e.target.value);
    save({ printMaxCopies: v }, `Guests can choose up to ${v} print${v === 1 ? '' : 's'}.`);
  };
  $('btnPrintRefresh').onclick = async () => {
    const list = await fillPrinters((state.cfg && state.cfg.printer) || $('setPrinter').value);
    flash('printMsg', list.length ? `${list.length} printer(s) found.` : 'No printers found. Is it on and connected?');
  };
  $('btnPrintTest').onclick = async () => {
    const r = await api.printTest();
    if (!r || !r.ok) return flash('printMsg', (r && r.error) || 'Could not print the test page.', true);
    flash(
      'printMsg',
      $('setPrinter').value ? 'Test page sent to the printer.' : 'Test page saved as PDF in <couple>/Foto/Print.',
    );
  };
  $('btnPrintRetry').onclick = async () => {
    const st = await api.printRetry();
    renderPrintStatus(st);
    flash('printMsg', `${st.retried} print(s) sent again.`);
  };
  $('btnPrintClear').onclick = async () => {
    const st = await api.printClearFailed();
    renderPrintStatus(st);
    flash('printMsg', `${st.removed} failed print(s) removed. Their files stay in the Print folder.`);
  };
  if (api.onPrintStatus) api.onPrintStatus(renderPrintStatus);
}
