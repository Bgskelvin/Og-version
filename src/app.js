/* =====================================================================
   app.js — navigasi antar halaman, kembali otomatis (idle), notifikasi
   ===================================================================== */

function show(name) {
  current = name;
  // Nama {couple} di pratinjau template = couple yang sedang diedit, hanya selama di halaman couple/editor.
  // Di halaman lain (termasuk foto tamu) selalu couple aktif.
  namaCoupleTemplate = ['tambah', 'tpleditor'].includes(name) && coupleTemplate ? coupleTemplate.name : null;
  SCREENS.forEach(s => $(s).classList.toggle('on', s === name));
  document.body.classList.toggle('camOn', ['utama', 'pesan', 'quiz', 'photo'].includes(name));
  resetIdle();
}
function resetIdle() {
  clearTimeout(idleTimer);
  if (busy) return;
  const wait = { utama: 60000, pesan: 60000, quiz: 60000, photo: 60000, editphoto: 180000, admin: 180000, riwayat: 600000, setvideo: 180000, setphoto: 180000, tpleditor: 900000, tambah: 900000, thanks: 20000 }[current];
  if (wait) idleTimer = setTimeout(() => show('start'), wait);
}
function setNotice(t, ms) {
  clearTimeout(noticeTimer);
  $('notice').textContent = t; $('notice').style.display = t ? 'block' : 'none';
  if (t && ms) noticeTimer = setTimeout(() => setNotice(''), ms);
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
function pasangNavigasi() {
  $('btnStart').onclick = () => show('utama');
  $('btnCobaLagi').onclick = () => show('utama');
  $('btnSelesai').onclick = () => show('start');
}
