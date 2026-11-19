/* =====================================================================
   album.js — Album.html in every event folder: an offline gallery of the
   wedding, one entry per guest (their video messages, quiz videos and
   photos). It opens in any browser straight from the folder, also on the
   couple's own computer, and plays the files next to it (relative links).
   - Made only when Admin asks (couple page → "Create album"), usually after
     the event: nothing runs in the background while guests use the booth.
     Pressing it again brings the album up to date. Admin first sees whether
     videos are still being processed (they would show "still being prepared")
     and how many sessions came after the last album (albumStatus).
   - The data is put in the page as JSON and drawn by the page's own script
     with textContent, so a guest name can never break or inject the page.
   - Written the safe way (temporary file, then renamed).
   - Text follows the guest screen language (Admin → Display); the gold is
     the booth's accent color.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const { readSessions, readSettings } = require('./storage');
const eventFolders = require('./event-folders');
const log = require('./log');

const TEXT = {
  id: {
    lang: 'id',
    title: 'Buku tamu',
    subtitle: 'Buku tamu pernikahan',
    guests: n => `${n} tamu`,
    summary: (g, m, q, p) =>
      `${g} datang dan meninggalkan ${list([m && `${m} pesan video`, q && `${q} jawaban quiz`, p && `${p} sesi foto`], 'dan')}.`,
    empty: 'Belum ada kenangan di sini.',
    messages: 'Pesan video',
    quiz: 'Quiz',
    photos: 'Foto',
    search: 'Cari nama tamu',
    noMatch: 'Tidak ada tamu dengan nama itu.',
    guestNo: 'No.',
    anonymous: 'Tamu',
    message: 'Pesan video',
    quizVideo: 'Quiz',
    processing: 'sedang disiapkan',
    missing: 'file tidak ditemukan',
    originals: 'Foto asli',
    printed: n => `dicetak ${n} lembar`,
    close: 'Tutup',
    prev: 'Sebelumnya',
    next: 'Berikutnya',
    play: 'Putar',
    made: 'Dibuat dengan Leura',
    locale: 'id-ID',
  },
  en: {
    lang: 'en',
    title: 'Guestbook',
    subtitle: 'Wedding guestbook',
    guests: n => `${n} guest${n === 1 ? '' : 's'}`,
    summary: (g, m, q, p) =>
      `${g} came by and left ${list([m && `${m} video message${m === 1 ? '' : 's'}`, q && `${q} quiz answer${q === 1 ? '' : 's'}`, p && `${p} photo session${p === 1 ? '' : 's'}`], 'and')}.`,
    empty: 'No memories here yet.',
    messages: 'Video messages',
    quiz: 'Quiz',
    photos: 'Photos',
    search: 'Find a guest',
    noMatch: 'No guest with that name.',
    guestNo: 'No.',
    anonymous: 'Guest',
    message: 'Video message',
    quizVideo: 'Quiz',
    processing: 'still being prepared',
    missing: 'file not found',
    originals: 'Original photos',
    printed: n => `printed ${n}×`,
    close: 'Close',
    prev: 'Previous',
    next: 'Next',
    play: 'Play',
    made: 'Made with Leura',
    locale: 'en-GB',
  },
};
function list(parts, and) {
  const p = parts.filter(Boolean);
  if (p.length <= 1) return p.join('');
  return p.slice(0, -1).join(', ') + ` ${and} ` + p.at(-1);
}

// Relative link from the album to a file, safe for any character in the name
const link = (eventDir, file) => path.relative(eventDir, file).split(path.sep).map(encodeURIComponent).join('/');

function albumData(eventDir) {
  const own = readSessions().filter(
    s => eventFolders.eventDirOf(s) && path.resolve(eventFolders.eventDirOf(s)) === path.resolve(eventDir),
  );
  const guests = new Map();
  for (const s of own.sort((a, b) => Date.parse(a.time) - Date.parse(b.time))) {
    const key = s.seq || s.id;
    if (!guests.has(key)) guests.set(key, { no: s.seq || 0, name: s.guest || '', time: s.time, items: [] });
    const g = guests.get(key);
    if (!g.name && s.guest) g.name = s.guest;
    const file = path.join(s.dir, s.file || '');
    const exists = !!s.file && fs.existsSync(file);
    if (s.label === 'photo') {
      if (s.status !== 'photo') continue;
      const originals = (s.originalFiles || [])
        .map(f => path.join(s.originalsDir || s.dir, f))
        .filter(f => fs.existsSync(f))
        .map(f => link(eventDir, f));
      g.items.push({
        kind: 'photo',
        src: exists ? link(eventDir, file) : null,
        originals,
        prints: s.prints || 0,
        time: s.time,
      });
    } else {
      if (['lost', 'write-error', 'recording'].includes(s.status)) continue;
      const ready = exists && ['done', 'webm', 'failed'].includes(s.status);
      g.items.push({
        kind: /^quiz/.test(s.label) ? 'quiz' : 'message',
        src: ready ? link(eventDir, file) : null,
        state: ready ? 'ready' : exists || s.status !== 'card-only' ? 'processing' : 'missing',
        seconds: s.seconds || 0,
        time: s.time,
      });
    }
  }
  const settings = readSettings();
  const lang = settings.language === 'id' ? 'id' : 'en';
  const folder = path.basename(eventDir);
  const m = folder.match(/^(\d{4})-(\d{2})-(\d{2}) ?(.*)$/);
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  const couple = (own.find(s => s.couple) || {}).couple || (m ? m[4] : folder);
  return {
    lang,
    couple,
    date: date ? date.toLocaleDateString(TEXT[lang].locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '',
    accent: /^#[0-9a-f]{6}$/i.test(settings.accent || '') ? settings.accent : '#B08D57',
    guests: [...guests.values()].filter(g => g.items.length),
  };
}

const escapeHtml = s =>
  String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function albumHtml(data) {
  const t = TEXT[data.lang];
  const count = k => data.guests.reduce((n, g) => n + g.items.filter(i => i.kind === k).length, 0);
  const words = {
    guestNo: t.guestNo,
    anonymous: t.anonymous,
    message: t.message,
    quizVideo: t.quizVideo,
    processing: t.processing,
    missing: t.missing,
    originals: t.originals,
    printed: t.printed('{n}'),
    empty: t.empty,
    noMatch: t.noMatch,
    close: t.close,
    prev: t.prev,
    next: t.next,
    play: t.play,
    locale: t.locale,
  };
  const summary = data.guests.length
    ? t.summary(t.guests(data.guests.length), count('message'), count('quiz'), count('photo'))
    : t.empty;
  const json = s => JSON.stringify(s).replace(/</g, '\\u003c');
  // The couple's names: the "&" (or "dan" / "and") becomes the large gold mark behind the names
  const parts = String(data.couple).split(/\s+(?:&|dan|and)\s+/i);
  const names =
    parts.length === 2
      ? `<span>${escapeHtml(parts[0])}</span><span class="amp" aria-hidden="true">&amp;</span><span>${escapeHtml(parts[1])}</span>`
      : `<span>${escapeHtml(data.couple)}</span>`;
  return `<!doctype html>
<html lang="${t.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.couple)} · ${escapeHtml(t.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<style>
:root {
  --paper: #f6f4f1;
  --ink: #25211f;
  --stone: #7a726b;
  --hair: #dfd9d2;
  --white: #fffefc;
  --gold: ${data.accent};
  --serif: 'Cormorant Garamond', 'Cormorant', Georgia, 'Times New Roman', serif;
  --sans: 'Jost', 'Avenir Next', 'Segoe UI', system-ui, sans-serif;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 300 16px/1.6 var(--sans); }
img, video { display: block; max-width: 100%; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }

/* ---- The couple ---- */
.hero { position: relative; padding: clamp(72px, 14vh, 150px) 24px clamp(48px, 9vh, 90px); text-align: center; overflow: hidden; }
.names { position: relative; margin: 0; font: italic 400 clamp(52px, 9vw, 128px)/0.95 var(--serif); letter-spacing: -0.01em; }
.names span { position: relative; z-index: 1; display: block; }
.names .amp { position: absolute; z-index: 0; left: 50%; top: 50%; transform: translate(-50%, -54%);
  font-size: 2.6em; color: var(--gold); opacity: 0.22; line-height: 1; pointer-events: none; }
.names span + .amp + span { margin-top: 0.08em; }
.date { margin: 34px 0 0; font: 400 15px/1.4 var(--sans); letter-spacing: 0.08em; color: var(--stone); }
.summary { max-width: 34em; margin: 14px auto 0; font: italic 400 21px/1.5 var(--serif); color: var(--stone); }
@media (prefers-reduced-motion: no-preference) {
  .names span:not(.amp) { animation: rise 1.1s cubic-bezier(.2,.8,.2,1) both; }
  .names span:last-child { animation-delay: .18s; }
  .names .amp { animation: glow 1.8s ease-out .2s both; }
  @keyframes rise { from { opacity: 0; transform: translateY(18px); filter: blur(6px); } }
  @keyframes glow { from { opacity: 0; } }
}

/* ---- Filter & search ---- */
.bar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
  gap: 8px 28px; padding: 14px 24px; background: color-mix(in srgb, var(--paper) 88%, transparent);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border-block: 1px solid var(--hair); }
.tabs { display: flex; gap: 22px; }
.tab { padding: 6px 0; border: 0; background: none; cursor: pointer; font-size: 15px; color: var(--stone);
  border-bottom: 1px solid transparent; }
.tab[aria-pressed="true"] { color: var(--ink); border-bottom-color: var(--gold); }
.tab small { margin-left: 5px; font-size: 12px; }
.find { width: min(240px, 100%); padding: 6px 2px; border: 0; border-bottom: 1px solid var(--hair); background: none;
  font: 400 15px var(--sans); color: var(--ink); }
.find::placeholder { color: var(--stone); }
.find:focus { outline: none; border-bottom-color: var(--gold); }

/* ---- Guests ---- */
main { max-width: 1240px; margin: 0 auto; padding: 56px 24px 40px; }
.guests { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 64px 40px; align-items: start; }
.guest { margin: 0; }
.print { position: relative; display: block; width: 100%; padding: 10px 10px 34px; border: 0; background: var(--white);
  cursor: zoom-in; box-shadow: 0 1px 2px rgba(37,33,31,.08), 0 14px 34px -14px rgba(37,33,31,.28); transition: transform .35s ease, box-shadow .35s ease; }
.print:hover { transform: translateY(-3px); box-shadow: 0 1px 2px rgba(37,33,31,.08), 0 22px 44px -16px rgba(37,33,31,.32); }
.print img { width: 100%; height: auto; background: var(--hair); }
.print .count { position: absolute; right: 12px; bottom: 9px; font: italic 400 15px var(--serif); color: var(--stone); }
.letter { padding: 30px 28px 26px; background: var(--white); border-top: 2px solid var(--gold);
  box-shadow: 0 1px 2px rgba(37,33,31,.06), 0 10px 26px -16px rgba(37,33,31,.22); }
.who { display: flex; align-items: baseline; gap: 14px; margin: 18px 2px 4px; }
.letter .who { margin-top: 0; }
.no { font: 400 13px var(--sans); color: var(--gold); letter-spacing: 0.04em; white-space: nowrap; }
.name { margin: 0; font: italic 500 30px/1.15 var(--serif); overflow-wrap: anywhere; }
.when { margin: 0 2px; font-size: 13px; color: var(--stone); }
.clips { margin: 12px 0 0; padding: 0; list-style: none; }
.clip { display: flex; align-items: center; gap: 14px; padding: 10px 2px; border-top: 1px solid var(--hair); }
.clip:last-child { border-bottom: 1px solid var(--hair); }
.letter .clip { margin-top: 14px; padding-bottom: 0; border-bottom: 0; }
.play { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%;
  border: 1px solid var(--gold); background: none; color: var(--gold); cursor: pointer; transition: background .2s, color .2s; }
.play:hover { background: var(--gold); color: var(--white); }
.play svg { width: 14px; height: 14px; margin-left: 2px; fill: currentColor; }
.clip-text { flex: 1; font-size: 15px; }
.clip-text small { display: block; font-size: 13px; color: var(--stone); }
.wait { flex: none; width: 40px; height: 40px; border-radius: 50%; border: 1px dashed var(--hair); }
.originals { display: flex; gap: 8px; margin: 12px 2px 0; }
.originals button { flex: 1; padding: 0; border: 0; background: none; cursor: zoom-in; aspect-ratio: 3 / 2; overflow: hidden; }
.originals img { width: 100%; height: 100%; object-fit: cover; transition: opacity .2s; }
.originals button:hover img { opacity: .82; }
.note { padding: 80px 0; text-align: center; font: italic 400 24px var(--serif); color: var(--stone); grid-column: 1 / -1; }
footer { padding: 30px 24px 60px; text-align: center; font-size: 13px; color: var(--stone); }
footer::before { content: ''; display: block; width: 44px; height: 1px; margin: 0 auto 22px; background: var(--gold); }

/* ---- Viewer (photos & videos) ---- */
.viewer { position: fixed; inset: 0; z-index: 20; display: none; align-items: center; justify-content: center;
  padding: 64px 72px; background: rgba(28, 24, 22, .97); }
.viewer.open { display: flex; }
.viewer figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 16px; max-width: 100%; max-height: 100%; }
.viewer img, .viewer video { max-width: 100%; max-height: calc(100vh - 170px); box-shadow: 0 30px 80px rgba(0,0,0,.45); background: #000; }
.viewer figcaption { font: italic 400 22px var(--serif); color: #efe9e2; text-align: center; }
.viewer figcaption small { display: block; font: 300 13px var(--sans); color: #b5aca4; }
.viewer .x, .viewer .nav { position: absolute; border: 0; background: none; color: #efe9e2; cursor: pointer; padding: 12px; opacity: .8; }
.viewer .x:hover, .viewer .nav:hover { opacity: 1; }
.viewer .x { top: 14px; right: 18px; font-size: 15px; }
.viewer .nav { top: 50%; transform: translateY(-50%); font: 300 40px/1 var(--sans); }
.viewer .prev { left: 14px; } .viewer .next { right: 14px; }
@media (prefers-reduced-motion: no-preference) { .viewer.open figure { animation: show .35s ease both; } @keyframes show { from { opacity: 0; transform: scale(.98); } } }
@media (max-width: 640px) {
  .viewer { padding: 56px 12px; }
  .viewer .nav { top: auto; bottom: 8px; transform: none; }
  .tabs { gap: 16px; }
}
@media print { .bar, .viewer { display: none !important; } body { background: #fff; } }
</style>
</head>
<body>
<header class="hero">
  <h1 class="names">${names}</h1>
  ${data.date ? `<p class="date">${escapeHtml(data.date)}</p>` : ''}
  <p class="summary">${escapeHtml(summary)}</p>
</header>
<nav class="bar" aria-label="${escapeHtml(t.title)}">
  <div class="tabs" role="group">
    <button class="tab" data-kind="message" aria-pressed="false">${escapeHtml(t.messages)}<small>${count('message')}</small></button>
    <button class="tab" data-kind="quiz" aria-pressed="false">${escapeHtml(t.quiz)}<small>${count('quiz')}</small></button>
    <button class="tab" data-kind="photo" aria-pressed="false">${escapeHtml(t.photos)}<small>${count('photo')}</small></button>
  </div>
  <input class="find" type="search" placeholder="${escapeHtml(t.search)}" aria-label="${escapeHtml(t.search)}">
</nav>
<main><div class="guests" id="guests"></div></main>
<footer>${escapeHtml(t.made)}</footer>
<div class="viewer" id="viewer" role="dialog" aria-modal="true">
  <button class="x">${escapeHtml(t.close)}</button>
  <button class="nav prev" aria-label="${escapeHtml(t.prev)}">‹</button>
  <figure></figure>
  <button class="nav next" aria-label="${escapeHtml(t.next)}">›</button>
</div>
<script id="album-data" type="application/json">${json({ guests: data.guests, words })}</script>
<script>${CLIENT_JS}</script>
</body>
</html>
`;
}

// The page's own script (no template placeholders inside: it reads the JSON above)
const CLIENT_JS = `
(function () {
  var data = JSON.parse(document.getElementById('album-data').textContent);
  var w = data.words;
  var box = document.getElementById('guests'), viewer = document.getElementById('viewer');
  var fig = viewer.querySelector('figure');
  var query = '', slides = [], at = 0, lastFocus = null;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clock(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString(w.locale, { hour: '2-digit', minute: '2-digit' }); }
  function length(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  var PLAY = '<svg viewBox="0 0 12 14" aria-hidden="true"><path d="M0 0l12 7-12 7z"/></svg>';

  // One list per page (video messages, quiz, photos), in the order they were made
  var pages = { message: [], quiz: [], photo: [] };
  data.guests.forEach(function (g) {
    g.items.forEach(function (it) {
      if (it.kind === 'photo' && !it.src) return;
      if (pages[it.kind]) pages[it.kind].push({ name: g.name || w.anonymous, time: it.time || g.time, item: it });
    });
  });
  Object.keys(pages).forEach(function (k) {
    pages[k].sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
  });
  var tabs = document.querySelectorAll('.tab');
  var kind = 'message';
  for (var i = 0; i < tabs.length; i++) {
    var k = tabs[i].getAttribute('data-kind');
    if (!pages[k].length) tabs[i].hidden = true; // no quiz at this wedding: no Quiz page
  }
  kind = ['message', 'quiz', 'photo'].filter(function (k) { return pages[k].length; })[0] || 'message';

  /* ---- Viewer ---- */
  function open(list, i) {
    slides = list; at = i; lastFocus = document.activeElement;
    viewer.classList.add('open'); show(); viewer.querySelector('.x').focus();
  }
  function close() {
    var v = fig.querySelector('video'); if (v) v.pause();
    viewer.classList.remove('open'); fig.textContent = '';
    if (lastFocus) lastFocus.focus();
  }
  function show() {
    var s = slides[at]; fig.textContent = '';
    var media;
    if (s.video) { media = el('video'); media.src = s.src; media.controls = true; media.autoplay = true; media.playsInline = true; }
    else { media = el('img'); media.src = s.src; media.alt = s.caption; }
    var cap = el('figcaption', null, s.caption);
    if (s.detail) cap.appendChild(el('small', null, s.detail));
    fig.appendChild(media); fig.appendChild(cap);
    var many = slides.length > 1;
    viewer.querySelector('.prev').style.visibility = many ? '' : 'hidden';
    viewer.querySelector('.next').style.visibility = many ? '' : 'hidden';
  }
  function step(d) { if (slides.length > 1) { var v = fig.querySelector('video'); if (v) v.pause(); at = (at + d + slides.length) % slides.length; show(); } }
  viewer.querySelector('.x').onclick = close;
  viewer.querySelector('.prev').onclick = function () { step(-1); };
  viewer.querySelector('.next').onclick = function () { step(1); };
  viewer.addEventListener('click', function (e) { if (e.target === viewer) close(); });
  document.addEventListener('keydown', function (e) {
    if (!viewer.classList.contains('open')) return;
    if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
  });

  /* ---- Entries ---- */
  function who(n, entry) {
    var h = el('div', 'who');
    h.appendChild(el('span', 'no', w.guestNo + ' ' + n));
    h.appendChild(el('h2', 'name', entry.name));
    return h;
  }
  function photoEntry(entry, n) {
    var p = entry.item, art = el('article', 'guest');
    var b = el('button', 'print'); b.type = 'button';
    var img = el('img'); img.src = p.src; img.alt = entry.name; img.loading = 'lazy'; img.decoding = 'async';
    b.appendChild(img);
    if (p.prints) b.appendChild(el('span', 'count', w.printed.replace('{n}', p.prints)));
    var list = [{ src: p.src, caption: entry.name, detail: w.guestNo + ' ' + n }].concat(p.originals.map(function (o, k) {
      return { src: o, caption: entry.name, detail: w.originals + ' ' + (k + 1) + '/' + p.originals.length };
    }));
    b.onclick = function () { open(list, 0); };
    art.appendChild(b);
    art.appendChild(who(n, entry));
    art.appendChild(el('p', 'when', clock(entry.time)));
    if (p.originals.length) {
      var row = el('div', 'originals');
      p.originals.forEach(function (o, k) {
        var ob = el('button'); ob.type = 'button'; ob.setAttribute('aria-label', w.originals + ' ' + (k + 1));
        var oi = el('img'); oi.src = o; oi.alt = ''; oi.loading = 'lazy'; oi.decoding = 'async';
        ob.appendChild(oi); ob.onclick = function () { open(list, k + 1); }; row.appendChild(ob);
      });
      art.appendChild(row);
    }
    return art;
  }
  function videoEntry(entry, n, playable) {
    var c = entry.item, art = el('article', 'guest');
    var letter = el('div', 'letter');
    letter.appendChild(who(n, entry));
    var clip = el('div', 'clip');
    var title = c.kind === 'quiz' ? w.quizVideo : w.message;
    if (c.src) {
      var b = el('button', 'play'); b.type = 'button'; b.innerHTML = PLAY;
      b.setAttribute('aria-label', w.play + ': ' + title + ', ' + entry.name);
      var idx = playable.map(function (p) { return p.src; }).indexOf(c.src);
      b.onclick = function () { open(playable, idx); };
      clip.appendChild(b);
    } else clip.appendChild(el('span', 'wait'));
    var tx = el('span', 'clip-text', clock(entry.time));
    tx.appendChild(el('small', null, c.src ? length(c.seconds) : (c.state === 'missing' ? w.missing : w.processing)));
    clip.appendChild(tx);
    letter.appendChild(clip);
    art.appendChild(letter);
    return art;
  }
  function render() {
    box.textContent = '';
    var q = query.trim().toLowerCase();
    var list = pages[kind].filter(function (e) { return !q || e.name.toLowerCase().indexOf(q) >= 0; });
    // Numbers start at 1 on every page and follow the order the moments were made (also while searching)
    var number = function (e) { return pages[kind].indexOf(e) + 1; };
    var playable = list.filter(function (e) { return e.item.src && kind !== 'photo'; }).map(function (e) {
      return { video: true, src: e.item.src, caption: e.name, detail: w.guestNo + ' ' + number(e) + ', ' + length(e.item.seconds) };
    });
    list.forEach(function (e) {
      box.appendChild(kind === 'photo' ? photoEntry(e, number(e)) : videoEntry(e, number(e), playable));
    });
    if (!list.length) box.appendChild(el('p', 'note', q ? w.noMatch : w.empty));
  }
  function choose(k) {
    kind = k;
    for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute('aria-pressed', String(tabs[i].getAttribute('data-kind') === k));
    render();
  }
  for (var j = 0; j < tabs.length; j++) (function (b) { b.onclick = function () { choose(b.getAttribute('data-kind')); }; })(tabs[j]);
  document.querySelector('.find').addEventListener('input', function (e) { query = e.target.value; render(); });
  choose(kind);
})();
`;

/* Write <event>/Album.html now. Returns its path, or null when there is nothing to show / it failed. */
function writeAlbum(eventDir) {
  try {
    const data = albumData(eventDir);
    const file = path.join(eventDir, eventFolders.ALBUM_FILE);
    if (!data.guests.length && !fs.existsSync(file)) return null;
    const tmp = path.join(eventFolders.systemDir(eventDir), 'album.tmp.html');
    fs.writeFileSync(tmp, albumHtml(data));
    fs.renameSync(tmp, file);
    return file;
  } catch (e) {
    log.warn(`Album could not be written (${path.basename(eventDir)}): ${e.message}`);
    return null;
  }
}
/* For the couple page: is there an album, when was it made, how many sessions came after it,
   and how many videos are still being processed (converted, questions added, copied from the camera). */
const BUSY = ['recording', 'processing', 'captions', 'transfer'];
function albumStatus(eventDir) {
  const file = path.join(eventDir, eventFolders.ALBUM_FILE);
  let made = null;
  try {
    made = fs.statSync(file).mtimeMs;
  } catch {
    /* no album yet */
  }
  const own = readSessions().filter(
    s => eventFolders.eventDirOf(s) && path.resolve(eventFolders.eventDirOf(s)) === path.resolve(eventDir),
  );
  return {
    sessions: own.length,
    made,
    newSince: made ? own.filter(s => Date.parse(s.time) > made).length : 0,
    processing: own.filter(s => BUSY.includes(s.status)).length,
  };
}

module.exports = { writeAlbum, albumData, albumHtml, albumStatus };
