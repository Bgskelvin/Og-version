/* =====================================================================
   unduh-qr.js — QR unduh foto di halaman Terima kasih, dan pengaturannya
   di Admin → Pengaturan photobooth → "Unduh foto lewat QR".
   Antrean unggahnya ada di main/unggah.js, servernya di cloud/worker.mjs.
   ===================================================================== */

let unggahSt = { aktif: false, menunggu: 0, terkirim: 0, errorTerakhir: '' };

// Tampilkan QR + link di halaman Terima kasih (link sudah ada walau foto belum terunggah)
function tampilkanQR(link) {
  const url = link + (bahasa === 'en' ? '?b=en' : '');
  try {
    gambarQR($('qrCanvas'), url, 8);
    $('qrLink').textContent = url.replace(/^https:\/\//, '');
    $('thanksQR').style.display = '';
    $('thanks').classList.add('tk-ada-qr');
  } catch (e) {
    console.log('QR gagal dibuat: ' + e.message);
    $('thanksQR').style.display = 'none';
    $('thanks').classList.remove('tk-ada-qr');
  }
}

/* ---------- Admin ---------- */
function tulisStatusUnggah() {
  if (!$('qrStatus')) return;
  const s = unggahSt;
  let teks, warna;
  if (!s.aktif) { teks = 'QR is off. Guests don\'t see a QR code.'; warna = ''; }
  else if (s.sedang) { teks = `Sending photos… · ${s.menunggu} in queue`; warna = 'kuning'; }
  else if (s.menunggu) { teks = `${s.menunggu} photo(s) waiting to be sent${s.errorTerakhir ? ' · ' + s.errorTerakhir : ''}`; warna = s.errorTerakhir ? 'merah' : 'kuning'; }
  else { teks = `On · all photos sent${s.terkirim ? ` (${s.terkirim} since the app opened)` : ''}${s.menungguSatuan ? ` · ${s.menungguSatuan} single shot(s) still uploading` : ''}`; warna = 'hijau'; }
  $('qrStatus').textContent = teks;
  $('qrDot').className = 'sony-dot ' + warna;
  $('btnQrUlang').style.display = s.menunggu && !s.sedang ? '' : 'none';
}
async function isiUnduhQR() {
  try { unggahSt = await api.unggahStatus(); } catch (e) { return; }
  $('setQrAktif').checked = unggahSt.aktif;
  $('setQrUrl').value = unggahSt.url || '';
  $('setQrKunci').value = '';
  $('setQrKunci').placeholder = unggahSt.adaKunci ? '•••••••• (saved)' : 'From npm run cloud:pasang';
  $('btnQrPasang').style.display = unggahSt.adaHasilPasang ? '' : 'none';
  tulisStatusUnggah();
}
async function simpanUnduhQR(patch, pesan) {
  const r = await api.unggahSimpan(patch);
  unggahSt = r;
  if (r.error) { flash('qrMsg', r.error, true); $('setQrAktif').checked = r.aktif; return false; }
  $('setQrKunci').value = '';
  $('setQrKunci').placeholder = r.adaKunci ? '•••••••• (saved)' : '';
  tulisStatusUnggah();
  if (pesan) flash('qrMsg', pesan);
  return true;
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
function pasangUnduhQR() {
  api.onUnggahStatus(s => { unggahSt = s; tulisStatusUnggah(); if (current === 'riwayat') segarkanRiwayat(); });
  $('setQrAktif').onchange = e => simpanUnduhQR({ aktif: e.target.checked },
    e.target.checked ? 'QR is on: photo booth guests will see a QR code on the Thank you page.' : 'QR turned off.');
  $('btnQrSimpan').onclick = () => {
    const patch = { url: $('setQrUrl').value };
    if ($('setQrKunci').value.trim()) patch.kunci = $('setQrKunci').value;
    simpanUnduhQR(patch, 'Server settings saved.');
  };
  $('btnQrTes').onclick = async () => {
    $('qrMsg').textContent = 'Checking…';
    const r = await api.unggahTes();
    if (r.error) flash('qrMsg', r.error, true);
    else flash('qrMsg', `Connected to the server. Photos are kept for ${r.hari} days.`);
  };
  $('btnQrPasang').onclick = async () => {
    const h = await api.unggahHasilPasang();
    if (h.error) return flash('qrMsg', h.error, true);
    $('setQrUrl').value = h.url;
    if (await simpanUnduhQR({ url: h.url, kunci: h.kunci }, 'Address & key loaded from the setup. Press "Test connection", then turn the QR on.')) $('setQrUrl').value = h.url;
  };
  $('btnQrUlang').onclick = async () => { unggahSt = await api.unggahCobaSekarang(); tulisStatusUnggah(); };
}
