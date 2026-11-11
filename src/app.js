/* =====================================================================
   app.js — navigasi antar halaman, kembali otomatis (idle), notifikasi
   ===================================================================== */

function show(name) {
  current = name;
  if (name === 'start') {
    namaTamu = '';
    kegiatanTamu = 0;
    if (typeof tulisSapaan === 'function') tulisSapaan();
  } // tamu berikutnya mulai dari nol
  if (name === 'thanks') kegiatanTamu++;
  if (name === 'utama') $('btnSelesaiTamu').style.display = kegiatanTamu ? '' : 'none';
  // Nama {couple} di pratinjau template = couple yang sedang diedit, hanya selama di halaman couple/editor.
  // Di halaman lain (termasuk foto tamu) selalu couple aktif.
  setTemplateCoupleName(
    ['tambah', 'tpleditor'].includes(name) && getTemplateCouple() ? getTemplateCouple().name : null,
  );
  SCREENS.forEach(s => $(s).classList.toggle('on', s === name));
  if (typeof modeUntukLayar === 'function') modeUntukLayar(name); // kamera Sony: mode video/foto sesuai halaman
  document.body.classList.toggle('camOn', ['utama', 'pesan', 'quiz', 'photo'].includes(name));
  resetIdle();
}
function resetIdle() {
  clearTimeout(idleTimer);
  if (busy) return;
  const wait = {
    nama: 60000,
    utama: 60000,
    pesan: 60000,
    quiz: 60000,
    photo: 60000,
    editphoto: 180000,
    admin: 180000,
    riwayat: 600000,
    setvideo: 180000,
    setphoto: 180000,
    tpleditor: 900000,
    tambah: 900000,
    thanks: 20000,
  }[current];
  // Halaman Terima kasih dengan QR tampil lebih lama supaya tamu sempat memindai
  const lama = current === 'thanks' && $('thanksQR') && $('thanksQR').style.display !== 'none' ? 60000 : wait;
  // Terima kasih → kembali ke menu (tamu mungkin ingin mencoba kegiatan lain); halaman lain → Start
  if (lama) idleTimer = setTimeout(() => show(current === 'thanks' ? 'utama' : 'start'), lama);
}
// Short green/red message under a form in Admin; clears itself after 4 seconds
function flash(id, text, isErr) {
  const el = $(id);
  el.className = 'note ' + (isErr ? 'err' : 'ok');
  el.textContent = text;
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.textContent = '';
  }, 4000);
}
function setNotice(t, ms) {
  clearTimeout(noticeTimer);
  $('notice').textContent = t;
  $('notice').style.display = t ? 'block' : 'none';
  if (t && ms) noticeTimer = setTimeout(() => setNotice(''), ms);
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari start.js)
function pasangNavigasi() {
  $('btnStart').onclick = mulaiTamu;
  $('btnCobaLagi').onclick = () => show('utama');
  $('btnSelesaiTamu').onclick = () => show('start');
}
