/* =====================================================================
   pengaturan.js — grup "Pengaturan" dan "Login Admin" di halaman Admin
   ===================================================================== */

const SWATCHES = [['#B08D57', 'Emas'], ['#C47A86', 'Rose'], ['#7C9A7E', 'Sage'], ['#3E6E9E', 'Biru'], ['#48484A', 'Grafit']];
const SECONDS = [20, 30, 45, 60, 90, 120, 180];
const secLabel = v => v < 60 ? `${v} detik` : `${String(v / 60).replace('.', ',')} menit`;
function fillSelect(sel, values, current, label) {
  sel.innerHTML = '';
  [...new Set([...values, current])].sort((a, b) => a - b).forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = label(v); o.selected = v === current;
    sel.appendChild(o);
  });
}
function renderSwatches(accent) {
  const box = $('swatches'); box.innerHTML = '';
  const list = SWATCHES.some(([c]) => c.toLowerCase() === accent.toLowerCase()) ? SWATCHES : [...SWATCHES, [accent, 'Warna saat ini']];
  list.forEach(([c, name]) => {
    const b = document.createElement('button');
    b.className = 'sw' + (c.toLowerCase() === accent.toLowerCase() ? ' on' : '');
    b.style.background = c; b.style.setProperty('--c', c);
    b.title = name; b.setAttribute('aria-label', 'Warna ' + name);
    b.onclick = () => saveSetting({ accent: c }, `Warna diganti ke ${name}.`);
    box.appendChild(b);
  });
}
function applySettings(s) {
  cfg.quizSeconds = s.quizSeconds;
  cfg.quizRounds = s.quizRounds;
  document.documentElement.style.setProperty('--accent', s.accent);
}
async function loadSettings() {
  const s = await api.getSettings();
  applySettings(s);
  fillSelect($('setSeconds'), SECONDS, s.quizSeconds, secLabel);
  fillSelect($('setRounds'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], s.quizRounds, v => `${v} pertanyaan`);
  renderSwatches(s.accent);
  $('setKiosk').checked = s.kiosk;
  $('setId').value = s.loginId;
  $('setOld').value = $('setNew').value = $('setNew2').value = '';
}
// Pengaturan langsung tersimpan dan berlaku, tanpa menutup aplikasi
async function saveSetting(patch, msg) {
  const s = await api.saveSettings(patch);
  applySettings(s);
  renderSwatches(s.accent);
  $('setKiosk').checked = s.kiosk;
  flash('setMsg', msg || 'Tersimpan.');
}
async function saveLogin() {
  if (!$('setOld').value) return flash('loginMsg', 'Isi password lama dulu.', true);
  if ($('setNew').value !== $('setNew2').value) return flash('loginMsg', 'Password baru dan ulangannya tidak sama.', true);
  const r = await api.changeLogin($('setOld').value, $('setId').value, $('setNew').value);
  if (r.error) return flash('loginMsg', r.error, true);
  $('setOld').value = $('setNew').value = $('setNew2').value = '';
  flash('loginMsg', `Login diganti. Masuk berikutnya pakai ID "${r.id}" dan password baru.`);
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
function pasangPengaturan() {
  $('setSeconds').onchange = e => saveSetting({ quizSeconds: Number(e.target.value) }, `Waktu jawab: ${secLabel(Number(e.target.value))}.`);
  $('setRounds').onchange = e => saveSetting({ quizRounds: Number(e.target.value) }, `Jumlah soal per sesi: ${e.target.value}.`);
  $('setKiosk').onchange = e => saveSetting({ kiosk: e.target.checked },
    e.target.checked ? 'Layar penuh aktif. Untuk keluar, matikan lagi di sini.' : 'Layar penuh dimatikan.');
  $('btnSaveLogin').onclick = saveLogin;
}
