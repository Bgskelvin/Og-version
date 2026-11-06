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
  if (!s.aktif) { teks = 'QR mati. Tamu tidak melihat QR.'; warna = ''; }
  else if (s.sedang) { teks = `Mengirim foto… · ${s.menunggu} dalam antrean`; warna = 'kuning'; }
  else if (s.menunggu) { teks = `${s.menunggu} foto menunggu dikirim${s.errorTerakhir ? ' · ' + s.errorTerakhir : ''}`; warna = s.errorTerakhir ? 'merah' : 'kuning'; }
  else { teks = `Aktif · semua foto terkirim${s.terkirim ? ` (${s.terkirim} sejak aplikasi dibuka)` : ''}`; warna = 'hijau'; }
  $('qrStatus').textContent = teks;
  $('qrDot').className = 'sony-dot ' + warna;
  $('btnQrUlang').style.display = s.menunggu && !s.sedang ? '' : 'none';
}
async function isiUnduhQR() {
  try { unggahSt = await api.unggahStatus(); } catch (e) { return; }
  $('setQrAktif').checked = unggahSt.aktif;
  $('setQrUrl').value = unggahSt.url || '';
  $('setQrKunci').value = '';
  $('setQrKunci').placeholder = unggahSt.adaKunci ? '•••••••• (tersimpan)' : 'Dari hasil npm run cloud:pasang';
  $('btnQrPasang').style.display = unggahSt.adaHasilPasang ? '' : 'none';
  tulisStatusUnggah();
}
async function simpanUnduhQR(patch, pesan) {
  const r = await api.unggahSimpan(patch);
  unggahSt = r;
  if (r.error) { flash('qrMsg', r.error, true); $('setQrAktif').checked = r.aktif; return false; }
  $('setQrKunci').value = '';
  $('setQrKunci').placeholder = r.adaKunci ? '•••••••• (tersimpan)' : '';
  tulisStatusUnggah();
  if (pesan) flash('qrMsg', pesan);
  return true;
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
function pasangUnduhQR() {
  api.onUnggahStatus(s => { unggahSt = s; tulisStatusUnggah(); if (current === 'riwayat') segarkanRiwayat(); });
  $('setQrAktif').onchange = e => simpanUnduhQR({ aktif: e.target.checked },
    e.target.checked ? 'QR aktif: tamu photobooth akan melihat QR di halaman Terima kasih.' : 'QR dimatikan.');
  $('btnQrSimpan').onclick = () => {
    const patch = { url: $('setQrUrl').value };
    if ($('setQrKunci').value.trim()) patch.kunci = $('setQrKunci').value;
    simpanUnduhQR(patch, 'Pengaturan server tersimpan.');
  };
  $('btnQrTes').onclick = async () => {
    $('qrMsg').textContent = 'Mengecek…';
    const r = await api.unggahTes();
    if (r.error) flash('qrMsg', r.error, true);
    else flash('qrMsg', `Tersambung ke server. Foto disimpan ${r.hari} hari.`);
  };
  $('btnQrPasang').onclick = async () => {
    const h = await api.unggahHasilPasang();
    if (h.error) return flash('qrMsg', h.error, true);
    $('setQrUrl').value = h.url;
    if (await simpanUnduhQR({ url: h.url, kunci: h.kunci }, 'Alamat & kunci diambil dari hasil pemasangan. Tekan "Tes sambungan" lalu nyalakan QR.')) $('setQrUrl').value = h.url;
  };
  $('btnQrUlang').onclick = async () => { unggahSt = await api.unggahCobaSekarang(); tulisStatusUnggah(); };
}
