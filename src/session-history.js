/* =====================================================================
   session-history.js — "Session history" page (opened from Admin)
   Messages, quizzes and photos per day, with colored status, warnings for
   sessions with problems, and per-session actions (play, Finder, retry).
   The status refreshes automatically every 3 seconds while the page is open.
   To stay light even with thousands of sessions:
   - the list shows 60 sessions at a time ("Show more" button);
   - photo thumbnails only load for rows visible on screen, and are put
     straight into their row without redrawing the list.
   Session data fields (label 'message'/'quiz'/'photo', captionStatus, upload,
   code, cardFile, …) come from the main process. Color names are CSS classes
   (green, blue, …).
   ===================================================================== */
import { drawQr } from './qr.js';
import { getUploadStatus, refreshUploadStatus } from './download-qr.js';
import { $, fmt, state } from './state.js';
import { flash, show } from './app.js';
import { language } from './language.js';

// status → [label, color class, needs attention?, explanation]
const SESSION_STATUS = {
  done: ['Ready', 'green', false, 'MP4 video is ready in the couple folder.'],
  photo: ['Saved', 'green', false, ''],
  processing: ['Processing', 'blue', false, 'Converting to MP4. One moment.'],
  captions: ['Adding questions', 'blue', false, 'Adding the question text to the quiz video. One moment.'],
  transfer: ['Copying from camera', 'blue', false, 'Copying from the camera SD card to the couple folder.'],
  recording: ['Recording', 'blue', false, 'Recording in progress.'],
  webm: ['Not MP4 yet', 'orange', true, 'Saved as WebM because FFmpeg is not installed. It plays in VLC or Chrome.'],
  'card-only': [
    'On SD card',
    'orange',
    true,
    'The video is safe on the camera SD card but has not been copied to the computer.',
  ],
  failed: [
    'MP4 failed',
    'red',
    true,
    'The video could not be converted to MP4. The original file is still in the "original" folder.',
  ],
  'write-error': ['Not saved', 'red', true, 'The recording could not be written to disk.'],
  lost: ['Lost', 'red', true, 'Empty recording: the app stopped before it could record.'],
};
const RETRYABLE = ['failed', 'webm', 'card-only'];
const SESSION_KINDS = [
  ['semua', 'All'],
  ['message', 'Messages'],
  ['quiz', 'Quiz'],
  ['photo', 'Photos'],
  ['perhatian', 'Needs attention'],
];

const PAGE_SIZE = 60;
const historyView = {
  couple: null,
  kind: 'semua',
  openId: null,
  data: [],
  fingerprint: '',
  timer: null,
  thumb: new Map(),
  limit: PAGE_SIZE,
  observer: null,
};

// Thumbnails load when their row gets near the screen (not all at once)
function thumbObserver() {
  if (historyView.observer || typeof IntersectionObserver === 'undefined') return historyView.observer;
  historyView.observer = new IntersectionObserver(
    entries => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        historyView.observer.unobserve(en.target);
        loadThumb(Number(en.target.dataset.id));
      }
    },
    { root: $('history').querySelector('.sheet-body'), rootMargin: '300px 0px' },
  );
  return historyView.observer;
}
function loadThumb(id) {
  if (historyView.thumb.has(id)) return;
  historyView.thumb.set(id, null);
  api
    .sessionThumb(id)
    .then(url => {
      if (!url) return;
      historyView.thumb.set(id, url);
      const el = document.querySelector(`#histList .hist-row[data-id="${id}"] .hist-icon`); // put straight into its row
      if (el) el.innerHTML = `<img alt="" src="${url}">`;
    })
    .catch(e => console.warn('Session thumbnail could not be loaded: ' + e.message));
}

const sessionKind = s => (s.label === 'photo' ? 'photo' : /^quiz/.test(s.label) ? 'quiz' : 'message');
const statusInfo = s => SESSION_STATUS[s.status] || ['—', 'gray', false, ''];
// Question text / phone version for the QR failed: the video is safe, but needs "Process again"
const processingFailed = s => s.status === 'done' && (s.captionStatus === 'failed' || s.upload === 'failed');
const needsAttention = s => statusInfo(s)[2] || processingFailed(s);
const tooShort = s =>
  sessionKind(s) !== 'photo' && (s.seconds || 0) < 3 && ['done', 'webm', 'failed'].includes(s.status);
const sessionId = (s, i) => (s.id != null ? s.id : 'i' + i);
function dayName(d) {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  const dateText = day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return diff === 0 ? 'Today · ' + dateText : diff === 1 ? 'Yesterday · ' + dateText : dateText;
}
const sessionTime = time => {
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* ---------- Summary on the main Admin page ---------- */
function summarizeSessions(list, couple) {
  const own = couple ? list.filter(s => s.couple === couple) : list;
  const today = new Date().toDateString();
  return {
    today: own.filter(s => new Date(s.time).toDateString() === today).length,
    total: own.length,
    attention: own.filter(needsAttention).length,
  };
}
export async function loadSessions() {
  const list = await api.getSessions();
  const name = state.activeCouple ? state.activeCouple.name : null;
  const r = summarizeSessions(list, name);
  $('historySummary').textContent = `${name || 'All couples'}: ${r.today} today · ${r.total} total`;
  $('historyBadge').textContent = r.attention ? `⚠️ ${r.attention}` : '';
  $('historyBadge').style.display = r.attention ? '' : 'none';
}

/* ---------- Session history page ---------- */
async function openHistory() {
  historyView.couple = state.activeCouple ? state.activeCouple.name : '';
  historyView.kind = 'semua';
  historyView.openId = null;
  historyView.fingerprint = '';
  historyView.limit = PAGE_SIZE;
  show('history');
  $('history').querySelector('.sheet-body').scrollTop = 0;
  try {
    await refreshUploadStatus();
  } catch {
    /* no QR status: links for older sessions are not shown */
  } // needed to build QR links for older sessions
  await refreshHistory(true);
  clearInterval(historyView.timer);
  historyView.timer = setInterval(() => {
    if (state.current === 'history') refreshHistory();
    else clearInterval(historyView.timer);
  }, 3000);
}
export async function refreshHistory(force = false) {
  let list = [];
  try {
    list = await api.getSessions();
  } catch (e) {
    console.warn('Session history could not be loaded: ' + e.message);
  }
  const fingerprint = JSON.stringify(list);
  if (!force && fingerprint === historyView.fingerprint) return; // nothing changed: don't redraw
  historyView.fingerprint = fingerprint;
  historyView.data = list;
  renderHistory();
}

function renderHistory() {
  const all = historyView.data.map((s, i) => ({ ...s, _id: sessionId(s, i) }));
  // Couple choice
  const names = [
    ...new Set([
      ...(state.couplesData ? state.couplesData.couples.map(c => c.name) : []),
      ...all.map(s => s.couple).filter(Boolean),
    ]),
  ];
  const sel = $('histCouple');
  sel.innerHTML = '';
  for (const [v, label] of [['', 'All couples'], ...names.map(n => [n, n])]) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    if (v === historyView.couple) o.selected = true;
    sel.appendChild(o);
  }
  const own = historyView.couple ? all.filter(s => s.couple === historyView.couple) : all;

  // Summary
  const countKind = j => own.filter(s => sessionKind(s) === j).length;
  const minutes = Math.round(
    own.filter(s => sessionKind(s) !== 'photo').reduce((sum, s) => sum + (s.seconds || 0), 0) / 60,
  );
  $('histSummary').innerHTML = [
    ['Messages', countKind('message')],
    ['Quiz', countKind('quiz')],
    ['Photos', countKind('photo')],
    ['Video minutes', minutes],
  ]
    .map(([label, n]) => `<div><b>${n}</b><span>${label}</span></div>`)
    .join('');

  // Warning
  const problems = own.filter(needsAttention).length;
  const banner = $('histBanner');
  banner.style.display = problems || historyView.kind === 'perhatian' ? '' : 'none';
  banner.className = 'hist-banner' + (historyView.kind === 'perhatian' ? ' active' : '');
  banner.textContent =
    historyView.kind === 'perhatian'
      ? problems
        ? `Showing ${problems} session(s) that need attention · Show all`
        : 'No sessions with problems · Show all'
      : `⚠️ ${problems} session(s) need attention · tap to view`;

  // Kind choice
  const chips = $('histKind');
  chips.innerHTML = '';
  for (const [k, label] of SESSION_KINDS) {
    const b = document.createElement('button');
    b.className = 'hist-chip' + (historyView.kind === k ? ' on' : '');
    b.textContent = label + (k === 'perhatian' && problems ? ` (${problems})` : '');
    b.onclick = () => {
      historyView.kind = k;
      historyView.openId = null;
      historyView.limit = PAGE_SIZE;
      renderHistory();
    };
    chips.appendChild(b);
  }

  // List per day, newest on top
  const visible = own
    .filter(s =>
      historyView.kind === 'semua'
        ? true
        : historyView.kind === 'perhatian'
          ? needsAttention(s)
          : sessionKind(s) === historyView.kind,
    )
    .sort((a, b) => new Date(b.time) - new Date(a.time));
  const box = $('histList');
  box.innerHTML = '';
  if (!visible.length) {
    const k = document.createElement('div');
    k.className = 'group';
    k.innerHTML = '<div class="item muted">No sessions here yet.</div>';
    box.appendChild(k);
    return;
  }
  if (historyView.observer) historyView.observer.disconnect();
  let day = null,
    group = null;
  for (const s of visible.slice(0, historyView.limit)) {
    const h = new Date(s.time).toDateString();
    if (h !== day) {
      day = h;
      const title = document.createElement('div');
      title.className = 'group-title';
      title.textContent = dayName(s.time);
      group = document.createElement('div');
      group.className = 'group';
      box.append(title, group);
    }
    group.appendChild(sessionRow(s));
    if (historyView.openId === s._id) group.appendChild(sessionDetail(s));
  }
  if (visible.length > historyView.limit) {
    const more = document.createElement('button');
    more.className = 'btn sm tint hist-retry';
    more.id = 'histMore';
    more.textContent = `Show more (${visible.length - historyView.limit} more sessions)`;
    more.onclick = () => {
      historyView.limit += PAGE_SIZE;
      renderHistory();
    };
    box.appendChild(more);
  }
}

function sessionRow(s) {
  const [label, color] = statusInfo(s),
    kind = sessionKind(s);
  const b = document.createElement('button');
  b.className = 'item hist-row' + (historyView.openId === s._id ? ' open' : '');
  b.dataset.id = s._id;
  const icon = { message: 'i-mic', quiz: 'i-spark', photo: 'i-camera' }[kind];
  const kindName = { message: 'Message', quiz: 'Quiz', photo: 'Photo' }[kind];
  const sub =
    kind === 'photo'
      ? `${s.photos || 4} photos${s.template ? ' · ' + s.template : ''}`
      : fmt(s.seconds || 0) + (s.camera === 'sony' ? ' · Sony camera' : '');
  b.innerHTML = `<span class="hist-icon"></span><span class="hist-text"><b></b><small></small></span><span class="hist-tag"></span><em class="hist-status ${color}"></em>`;
  if (kind === 'photo' && historyView.thumb.get(s._id))
    b.querySelector('.hist-icon').innerHTML = `<img alt="" src="${historyView.thumb.get(s._id)}">`;
  else {
    b.querySelector('.hist-icon').innerHTML = `<svg class="i"><use href="#${icon}"/></svg>`;
    if (kind === 'photo' && !historyView.thumb.has(s._id) && typeof s._id === 'number') {
      const o = thumbObserver();
      if (o) o.observe(b);
      else loadThumb(s._id);
    }
  }
  b.querySelector('b').textContent = `${sessionTime(s.time)} · ${kindName}${s.guest ? ' · ' + s.guest : ''}`;
  b.querySelector('small').textContent = (historyView.couple ? '' : (s.couple || '-') + ' · ') + sub;
  b.querySelector('.hist-tag').textContent = tooShort(s) ? 'Too short' : s.recovered ? 'Recovered' : '';
  b.querySelector('.hist-status').textContent = label;
  b.onclick = () => {
    historyView.openId = historyView.openId === s._id ? null : s._id;
    renderHistory();
    const d = document.querySelector('#histList .hist-detail');
    if (d) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  return b;
}

function sessionDetail(s) {
  const d = document.createElement('div');
  d.className = 'item hist-detail';
  let note = statusInfo(s)[3] || (s.label === 'photo' ? `${s.photos || 4} original photos + 1 template photo.` : '');
  if (s.captionStatus === 'done')
    note +=
      ' The questions are shown at the bottom of the video; the version without text is in the "original" folder.';
  if (s.captionStatus === 'failed')
    note += ' The question text could not be added (the video itself is fine). Press "Process again".';
  const p = document.createElement('p');
  p.textContent = note + (s.error ? ` (${s.error})` : '') + (s.cardFile ? ` File on card: ${s.cardFile}.` : '');
  d.appendChild(p);
  if (Array.isArray(s.questions) && s.questions.length) {
    const ol = document.createElement('ol');
    s.questions.forEach(q => {
      const li = document.createElement('li');
      li.textContent = q;
      ol.appendChild(li);
    });
    const heading = document.createElement('div');
    heading.className = 'muted';
    heading.textContent = 'Questions:';
    d.append(heading, ol);
  }
  const link = sessionLink(s);
  if (s.code) {
    // download via QR
    const q = document.createElement('div');
    q.className = 'muted';
    const video = s.label !== 'photo';
    q.textContent =
      'QR: ' +
      ({
        sent: video ? '✓ guests can download the video' : '✓ guests can download the photos',
        queued: 'waiting to be sent to the server',
        waiting: 'waiting for internet / server',
        missing: `${video ? 'video' : 'photo'} file missing, cannot be sent`,
        processing:
          s.status === 'transfer'
            ? 'waiting for the video to be copied from the camera'
            : 'preparing the phone version of the video',
        failed: 'the phone version could not be made. Press "Process again".',
        'old-server': 'the server is too old for videos. Run npm run cloud:pasang.',
      }[s.upload] ||
        s.upload ||
        '-');
    d.appendChild(q);
    if (link) {
      const l = document.createElement('div');
      l.className = 'hist-link';
      l.textContent = link;
      d.appendChild(l);
    }
  }
  if (s.file) {
    const f = document.createElement('div');
    f.className = 'muted hist-file';
    f.textContent = s.file;
    d.appendChild(f);
  }
  const actions = document.createElement('div');
  actions.className = 'item actions';
  actions.style.padding = '10px 0 0';
  actions.style.border = '0';
  const addButton = (text, fn, cls = 'btn sm tint') => {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    b.onclick = fn;
    actions.appendChild(b);
  };
  const showResult = r => {
    if (r && r.error) flash('histMsg', r.error, true);
  };
  if (typeof s._id === 'number') {
    if (['done', 'photo', 'webm'].includes(s.status))
      addButton(s.label === 'photo' ? 'View photo' : 'Play video', async () =>
        showResult(await api.sessionOpen(s._id)),
      );
    addButton('Show in Finder', async () => showResult(await api.sessionReveal(s._id)));
    if (link) {
      addButton('Show QR', () => showSessionQr(s, link));
      addButton('Copy link', async () => {
        await api.copyText(link);
        flash('histMsg', 'Link copied. Paste it (⌘V) into WhatsApp or another message.');
      });
      addButton('Open link', async () => showResult(await api.openLink(link)));
    }
    if (RETRYABLE.includes(s.status) || processingFailed(s))
      addButton(
        s.status === 'card-only' ? 'Copy from camera again' : 'Process again',
        async () => {
          const r = await api.sessionRetry(s._id);
          if (r && r.error) return flash('histMsg', r.error, true);
          flash('histMsg', 'Trying again…');
          refreshHistory(true);
        },
        'btn sm primary',
      );
  }
  d.appendChild(actions);
  return d;
}

// Download link for this session. Older sessions only store the code → the link is built from the current server address.
export function sessionLink(s) {
  if (!s.code) return '';
  if (s.link) return s.link;
  const url = String(getUploadStatus().url || '').replace(/\/+$/, '');
  return url ? `${url}/${s.label === 'photo' ? 'f' : 'v'}/${s.code}` : '';
}
// Large QR for an earlier session (e.g. the guest forgot to scan it)
function showSessionQr(s, link) {
  const url = link + (language === 'en' ? '?b=en' : '');
  const overlay = document.createElement('div');
  overlay.className = 'hist-qr-overlay';
  overlay.id = 'rwQR';
  overlay.innerHTML = `<div class="hist-qr-card"><b></b><canvas></canvas><small></small><button class="btn sm primary">Close</button></div>`;
  overlay.querySelector('b').textContent =
    `${s.label === 'photo' ? 'Photo' : s.label === 'quiz' ? 'Quiz video' : 'Video message'} ${sessionTime(s.time)}${s.couple ? ' · ' + s.couple : ''}`;
  overlay.querySelector('small').textContent = url.replace(/^https:\/\//, '');
  try {
    drawQr(overlay.querySelector('canvas'), url, 8);
  } catch {
    return flash('histMsg', 'Could not create the QR code.', true);
  }
  const close = () => overlay.remove();
  overlay.onclick = e => {
    if (e.target === overlay) close();
  };
  overlay.querySelector('button').onclick = close;
  document.body.appendChild(overlay);
}

// Wire up this feature's buttons (called once from start.js)
export function setupHistory() {
  $('btnHistory').onclick = openHistory;
  $('histBack').onclick = () => {
    clearInterval(historyView.timer);
    show('admin');
    loadSessions();
  };
  $('histRefresh').onclick = () => refreshHistory(true);
  $('histCouple').onchange = e => {
    historyView.couple = e.target.value;
    historyView.openId = null;
    renderHistory();
  };
  $('histBanner').onclick = () => {
    historyView.kind = historyView.kind === 'perhatian' ? 'semua' : 'perhatian';
    historyView.openId = null;
    renderHistory();
  };
}
