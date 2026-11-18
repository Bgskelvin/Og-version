/* =====================================================================
   print.js — printing guest photos (Photo booth → "How many prints?").
   - The guest screen sends the finished print image (the template photo with
     the print-only QR) and the number of copies. It is saved as a JPG in
     <couple folder>/Foto/Print/ and added to the print queue.
   - The queue is kept in the database (app_state 'printQueue'), so jobs that
     were waiting when the app closed are printed when it opens again.
   - One job at a time. A job that fails stays in the queue as 'failed' with the
     reason; Admin → Photo booth settings → "Retry" sends it again.
   - Paper: 4×6 inch (10×15 cm), the standard photo booth paper for dye-sub
     printers (DNP, Citizen, HiTi, Mitsubishi …). Strip 2×6 templates are
     printed two side by side on one 4×6 sheet (the printer's 2-inch cut
     splits them), so 2 strips = 1 sheet.
   - No printer chosen in Admin = "Save as PDF (test)": every job becomes a
     4×6 PDF in the Print folder, so the whole flow can be tried without a printer.
   ===================================================================== */
const { ipcMain, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const log = require('./log');
const {
  db,
  defaultDir,
  getOutDir,
  usableDir,
  coupleDir,
  safeName,
  stamp,
  guestFileName,
  freeBaseName,
  readSettings,
  updateSession,
} = require('./storage');
const { activeCoupleName } = require('./couple');
const { getWin } = require('./active-window');

const STATE_KEY = 'printQueue';
const MAX_COPIES = 10; // per guest (Admin chooses the limit for guests, up to this)
const MAX_IMAGE = 30 * 1024 * 1024;
const PAPER = { width: 4, height: 6 }; // inches
const LAYOUTS = ['portrait', 'landscape', 'strip', 'square'];
const KEEP_DONE = 200; // finished jobs kept for the counters in Admin

let queue = [];
let loaded = false;
let running = false;
let lastError = '';

/* ---------- Queue (database) ---------- */
function load() {
  if (loaded) return;
  loaded = true;
  const saved = db.getState(STATE_KEY, []);
  queue = Array.isArray(saved) ? saved : [];
}
function persist() {
  try {
    db.setState(STATE_KEY, queue);
  } catch (e) {
    log.error('Could not save the print queue: ' + e.message);
  }
}

/* ---------- Paper layout ---------- */
// Sheets of paper for a job: strips go two per sheet
const sheetsFor = (layout, copies) => (layout === 'strip' ? Math.ceil(copies / 2) : copies);
// Which way the 4×6 sheet is turned: landscape templates are printed on a sideways sheet
const isLandscape = layout => layout === 'landscape';

/* The page printed on one sheet. The image is placed edge to edge (borderless); the
   printer's driver adds its own small overscan, so designs should keep text ±3 mm
   away from the edges. */
function pageHtml(imageUrl, layout) {
  const w = isLandscape(layout) ? PAPER.height : PAPER.width,
    h = isLandscape(layout) ? PAPER.width : PAPER.height;
  const img = `<img src="${imageUrl}" alt="">`;
  const body =
    layout === 'strip'
      ? `<div class="strips">${img}${img}</div>`
      : layout === 'square'
        ? `<div class="square">${img}</div>`
        : `<div class="full">${img}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${w}in ${h}in; margin: 0; }
html, body { margin: 0; padding: 0; width: ${w}in; height: ${h}in; overflow: hidden; background: #fff; }
.full, .strips, .square { width: 100%; height: 100%; display: flex; }
.full img { width: 100%; height: 100%; object-fit: cover; }
.strips img { width: 50%; height: 100%; object-fit: cover; }
.square { align-items: center; justify-content: center; }
.square img { width: 100%; aspect-ratio: 1; object-fit: cover; }
</style></head><body>${body}</body></html>`;
}

// Test page: thin lines 3 mm inside the edges show how much the printer cuts off
function testPageHtml(printerLabel) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${PAPER.width}in ${PAPER.height}in; margin: 0; }
html, body { margin: 0; width: ${PAPER.width}in; height: ${PAPER.height}in; overflow: hidden; background: #fff;
  font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color: #1d1d1f; }
.edge { position: absolute; inset: 0; border: 2px solid #b08d57; }
.safe { position: absolute; inset: 3mm; border: 1px dashed #6e6e73; }
.mid { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4mm; text-align: center; }
h1 { font-size: 20pt; margin: 0; } p { margin: 0; font-size: 9pt; color: #6e6e73; max-width: 80mm; }
.sw { display: flex; gap: 2mm; } .sw i { width: 9mm; height: 9mm; display: block; }
</style></head><body><div class="edge"></div><div class="safe"></div><div class="mid">
<h1>Leura test print</h1><p>4×6 inch · ${escapeHtml(printerLabel)}</p>
<div class="sw"><i style="background:#000"></i><i style="background:#ff3b30"></i><i style="background:#34c759"></i><i style="background:#0a84ff"></i><i style="background:#ffcc00"></i><i style="background:#b08d57"></i></div>
<p>The gold line is the paper edge, the dashed line is 3 mm inside it. If the gold line is missing the printer cuts a little off the edges: keep names and the QR inside the dashed line.</p>
</div></body></html>`;
}
const escapeHtml = s =>
  String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* ---------- Printing (Electron) ----------
   A hidden window loads the page, then prints it silently to the chosen printer,
   or saves it as a PDF when no printer is chosen. Replaced in the tests. */
async function electronDriver(job, printer) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leura-print-'));
  const html = path.join(tmp, 'page.html');
  fs.writeFileSync(
    html,
    job.test ? testPageHtml(printer || 'Save as PDF') : pageHtml(pathToFileURL(job.file).href, job.layout),
  );
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
  });
  try {
    await win.loadFile(html);
    const landscape = !job.test && isLandscape(job.layout);
    const sheets = job.test ? 1 : sheetsFor(job.layout, job.copies);
    if (!printer) {
      const pdf = await win.webContents.printToPDF({
        landscape: false, // the page size in the CSS is already turned the right way
        pageSize: landscape ? { width: PAPER.height, height: PAPER.width } : PAPER,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        printBackground: true,
        preferCSSPageSize: true,
      });
      const target = job.pdfFile;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, pdf);
      return { ok: true, pdf: target, sheets };
    }
    return await new Promise(resolve =>
      win.webContents.print(
        {
          silent: true,
          deviceName: printer,
          copies: sheets,
          printBackground: true,
          landscape,
          margins: { marginType: 'none' },
          pageSize: { width: PAPER.width * 25400, height: PAPER.height * 25400 }, // microns
        },
        (ok, reason) =>
          resolve(ok ? { ok: true, sheets } : { ok: false, error: reason || 'The printer refused the job' }),
      ),
    );
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.rm(tmp, { recursive: true, force: true }, () => {});
  }
}
let driver = electronDriver;

// The printer from Admin ('' = Save as PDF for testing)
const chosenPrinter = () => String(readSettings().printer || '');

/* ---------- Running the queue ---------- */
async function run() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = queue.find(j => j.status === 'waiting');
      if (!job) break;
      job.status = 'printing';
      job.attempts = (job.attempts || 0) + 1;
      persist();
      notify();
      const printer = chosenPrinter();
      let r;
      try {
        if (!job.test && !fs.existsSync(job.file)) throw new Error('The print file is missing: ' + job.file);
        r = await driver(job, printer);
      } catch (e) {
        r = { ok: false, error: e.message };
      }
      if (r && r.ok) {
        Object.assign(job, { status: 'done', printed: new Date().toISOString(), printer: printer || 'PDF' });
        if (r.pdf) job.pdfFile = r.pdf;
        delete job.error;
        lastError = '';
        log.write(
          `Printed: ${job.test ? 'test page' : path.basename(job.file)} · ${job.copies} cop${job.copies === 1 ? 'y' : 'ies'}` +
            ` · ${printer || 'saved as PDF ' + path.basename(r.pdf || '')}`,
        );
      } else {
        job.status = 'failed';
        job.error = (r && r.error) || 'Unknown error';
        lastError = job.error;
        log.error(`Print failed (${job.test ? 'test page' : path.basename(job.file)}): ${job.error}`);
      }
      trimDone();
      persist();
      notify();
    }
  } finally {
    running = false;
  }
}
function trimDone() {
  const done = queue.filter(j => j.status === 'done');
  if (done.length > KEEP_DONE) {
    const drop = new Set(done.slice(0, done.length - KEEP_DONE));
    queue = queue.filter(j => !drop.has(j));
  }
}

function status() {
  load();
  const printer = chosenPrinter();
  const count = s => queue.filter(j => j.status === s).length;
  const today = new Date().toDateString();
  const doneToday = queue.filter(j => j.status === 'done' && !j.test && new Date(j.printed).toDateString() === today);
  return {
    printer,
    waiting: count('waiting') + count('printing'),
    failed: count('failed'),
    printedToday: doneToday.reduce((n, j) => n + j.copies, 0),
    sheetsToday: doneToday.reduce((n, j) => n + sheetsFor(j.layout, j.copies), 0),
    lastError: lastError || (queue.filter(j => j.status === 'failed').at(-1) || {}).error || '',
  };
}
function notify() {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('print-status', status());
}

// Where the print files of the active couple go: <storage folder>/<couple>/Foto/Print
function printDir() {
  let base = getOutDir();
  if (!usableDir(base)) base = defaultDir;
  const dir = path.join(coupleDir(base, activeCoupleName()), 'Foto', 'Print');
  return usableDir(dir) ? dir : null;
}

/* Add a guest print. payload: { image (JPG bytes), copies, layout, guest, sessionId } */
function addJob(payload) {
  load();
  const { image, guest, sessionId } = payload || {};
  const copies = Math.round(Number(payload && payload.copies));
  if (!image || !image.length) return { ok: false, error: 'No print image' };
  if (image.length > MAX_IMAGE) return { ok: false, error: 'The print image is too large' };
  const bytes = Buffer.from(image);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return { ok: false, error: 'The print image must be a JPG' };
  if (!(copies >= 1 && copies <= MAX_COPIES)) return { ok: false, error: 'Choose 1 to 10 copies' };
  const layout = LAYOUTS.includes(payload.layout) ? payload.layout : 'portrait';
  const dir = printDir();
  if (!dir) return { ok: false, error: 'The print folder is not writable.' };
  const base = freeBaseName(
    guestFileName(guest) || (safeName(activeCoupleName()) ? safeName(activeCoupleName()) + '_' : '') + stamp(),
    b => fs.existsSync(path.join(dir, `${b}_print.jpg`)),
  );
  const file = path.join(dir, `${base}_print.jpg`);
  fs.writeFileSync(file, bytes);
  const job = {
    id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
    file,
    pdfFile: path.join(dir, `${base}_print_x${copies}.pdf`),
    copies,
    layout,
    couple: activeCoupleName(),
    ...(guest ? { guest: String(guest).trim().slice(0, 40) } : {}),
    ...(Number.isSafeInteger(sessionId) ? { sessionId } : {}),
    status: 'waiting',
    created: new Date().toISOString(),
  };
  queue.push(job);
  persist();
  if (job.sessionId) {
    try {
      updateSession(job.sessionId, { prints: copies }); // shown in Session history
    } catch (e) {
      log.warn('Could not note the prints on the session: ' + e.message);
    }
  }
  log.write(`Print queued: ${path.basename(file)} · ${copies} cop${copies === 1 ? 'y' : 'ies'} (${layout})`);
  setImmediate(run);
  return { ok: true, id: job.id };
}

// List the printers the computer knows (the main window asks the system)
async function listPrinters() {
  const win = getWin();
  if (!win || win.isDestroyed()) return [];
  try {
    const list = await win.webContents.getPrintersAsync();
    return list.map(p => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
  } catch (e) {
    log.warn('Printers could not be listed: ' + e.message);
    return [];
  }
}

function register() {
  ipcMain.handle('print-printers', () => listPrinters());
  ipcMain.handle('print-photo', (e, payload) => {
    try {
      return addJob(payload);
    } catch (err) {
      log.error('Could not queue the print: ' + err.message);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('print-status', () => status());
  // Failed jobs go back into the queue
  ipcMain.handle('print-retry', () => {
    load();
    let n = 0;
    for (const j of queue)
      if (j.status === 'failed') {
        j.status = 'waiting';
        n++;
      }
    if (n) {
      lastError = '';
      persist();
      setImmediate(run);
    }
    return { ...status(), retried: n };
  });
  // Failed jobs are dropped (the print file stays in the Print folder)
  ipcMain.handle('print-clear-failed', () => {
    load();
    const n = queue.filter(j => j.status === 'failed').length;
    queue = queue.filter(j => j.status !== 'failed');
    lastError = '';
    persist();
    if (n) log.write(`${n} failed print job(s) removed from the queue`);
    return { ...status(), removed: n };
  });
  ipcMain.handle('print-test', () => {
    load();
    const dir = printDir();
    if (!dir) return { ok: false, error: 'The print folder is not writable.' };
    queue.push({
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      test: true,
      file: null,
      pdfFile: path.join(dir, `Leura-test-print_${stamp()}.pdf`),
      copies: 1,
      layout: 'portrait',
      status: 'waiting',
      created: new Date().toISOString(),
    });
    persist();
    setImmediate(run);
    return { ok: true };
  });
}

// When the app opens: a job that was printing when the app closed is tried again
function start() {
  load();
  let changed = false;
  for (const j of queue)
    if (j.status === 'printing') {
      j.status = 'waiting';
      changed = true;
    }
  if (changed) persist();
  if (queue.some(j => j.status === 'waiting')) {
    log.write(`Print queue: ${queue.filter(j => j.status === 'waiting').length} job(s) continue`);
    setImmediate(run);
  }
}

module.exports = {
  register,
  start,
  status,
  pageHtml,
  sheetsFor,
  electronDriver, // the real printer / PDF path (checked by hand: it needs a real Electron)
  // Tests replace the real printer with a fake one
  setDriver: fn => {
    driver = fn || electronDriver;
  },
  idle: async () => {
    while (running) await new Promise(r => setTimeout(r, 20));
  },
};
