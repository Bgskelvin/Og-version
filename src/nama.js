/* =====================================================================
   nama.js — halaman "Siapa namamu?" setelah tamu menekan Start.
   Nama tamu dipakai sebagai nama file rekaman & foto di folder couple
   (mis. "Budi_pesan.mp4", "Budi_hasil.jpg"). Bisa dimatikan di
   Admin → Tampilan → "Tanya nama tamu".
   Keyboard layarnya ada di keyboard.js.
   ===================================================================== */

let kbNama = null;

// Tombol Start: ke halaman nama (kalau aktif), atau langsung ke Halaman Utama
function mulaiTamu() {
  namaTamu = '';
  if (!cfg.tanyaNama) return show('utama');
  $('namaInput').value = '';
  if (kbNama) kbNama.reset();
  show('nama');
  setTimeout(() => $('namaInput').focus({ preventScroll: true }), 50);
}
function lanjutNama() {
  const n = $('namaInput').value.replace(/\s+/g, ' ').trim();
  if (!n) return;
  namaTamu = n;
  tulisSapaan();
  show('utama');
}
// "Hai, Budi!" di Halaman Utama
function tulisSapaan() {
  const el = $('sapaTamu');
  el.textContent = namaTamu ? t('nama.hai', { nama: namaTamu }) : '';
  el.style.display = namaTamu ? '' : 'none';
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari start.js)
function pasangNama() {
  kbNama = buatKeyboard($('namaKeyboard'), $('namaInput'), { onEnter: lanjutNama, maks: 40 });
  $('btnNamaBack').onclick = () => show('start');
}
