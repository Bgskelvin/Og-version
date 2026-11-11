/* =====================================================================
   pengaturan.js — grup "Tampilan" dan "Login Admin" di halaman Admin,
   serta penerapan semua pengaturan ke aplikasi (applySettings)
   ===================================================================== */

const SWATCHES = [
  ['#B08D57', 'Gold'],
  ['#C47A86', 'Rose'],
  ['#7C9A7E', 'Sage'],
  ['#3E6E9E', 'Blue'],
  ['#48484A', 'Graphite'],
];
const SECONDS = [20, 30, 45, 60, 90, 120, 180];
const secLabel = v => (v < 60 ? `${v} seconds` : `${v / 60} minute${v === 60 ? '' : 's'}`);
function fillSelect(sel, values, current, label) {
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
// Nilai bawaan kalau ada pengaturan yang belum tersedia
const BAWAAN = {
  quizSeconds: 60,
  quizRounds: 3,
  pesanCountdown: 3,
  pesanMaxSeconds: 0,
  photoCountdown: 5,
  photoPreview: 2,
  photoFlash: true,
  enablePesan: true,
  enableQuiz: true,
  enablePhoto: true,
  tanyaNama: true,
};
function normalisasiCfg(src) {
  for (const [k, d] of Object.entries(BAWAAN)) {
    const v = src[k];
    cfg[k] =
      typeof d === 'boolean'
        ? typeof v === 'boolean'
          ? v
          : d
        : Number.isFinite(Number(v)) && v !== null && v !== ''
          ? Number(v)
          : d;
  }
}
// Tombol menu di Halaman Utama mengikuti pengaturan couple aktif (Admin → couple → Menu)
function menuCouple(c = activeCouple) {
  return (c && c.menu) || { pesan: true, quiz: true, photo: true };
}
function terapkanMenu() {
  const m = menuCouple();
  $('btnToPesan').style.display = m.pesan ? '' : 'none';
  $('btnToQuiz').style.display = m.quiz && cfg.quiz && cfg.quiz.length ? '' : 'none';
  $('btnToPhoto').style.display = m.photo ? '' : 'none';
}
// Terapkan pengaturan terbaru ke aplikasi tanpa perlu menutupnya
function applySettings(s) {
  normalisasiCfg(s);
  if (s.kamera) cfg.kamera = s.kamera;
  if (s.bahasa && s.bahasa !== bahasa) {
    cfg.bahasa = s.bahasa;
    setBahasa(s.bahasa);
    if (couplesData) applyCouples(couplesData); // sambutan & pertanyaan ikut bahasa baru
  }
  terapkanMenu();
  if (s.accent) document.documentElement.style.setProperty('--accent', s.accent);
}
async function loadSettings() {
  const s = await api.getSettings();
  applySettings(s);
  renderSwatches(s.accent);
  $('setKiosk').checked = s.kiosk;
  $('setTanyaNama').checked = cfg.tanyaNama;
  $('setBahasa').value = s.bahasa || 'en';
  $('setId').value = s.loginId;
  $('setOld').value = $('setNew').value = $('setNew2').value = '';
}
// Pengaturan langsung tersimpan dan berlaku, tanpa menutup aplikasi
async function saveSetting(patch, msg) {
  const s = await api.saveSettings(patch);
  applySettings(s);
  renderSwatches(s.accent);
  $('setKiosk').checked = s.kiosk;
  $('setTanyaNama').checked = cfg.tanyaNama;
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

// Pasang tombol-tombol fitur ini (dipanggil sekali dari start.js)
function pasangPengaturan() {
  $('setKiosk').onchange = e =>
    saveSetting(
      { kiosk: e.target.checked },
      e.target.checked ? 'Full screen is on. To leave it, turn it off here.' : 'Full screen is off.',
    );
  $('setBahasa').onchange = e =>
    saveSetting(
      { bahasa: e.target.value },
      e.target.value === 'en' ? 'Guest screens are now in English.' : 'Guest screens are now in Indonesian.',
    );
  $('setTanyaNama').onchange = e =>
    saveSetting(
      { tanyaNama: e.target.checked },
      e.target.checked
        ? 'Guests will be asked to type their name after pressing Start.'
        : 'Guests go straight to the main menu without typing a name.',
    );
  $('btnSaveLogin').onclick = saveLogin;
}
