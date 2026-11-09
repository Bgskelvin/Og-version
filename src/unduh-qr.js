/* =====================================================================
   unduh-qr.js — QR unduh foto di halaman Terima kasih, dan pengaturannya
   di Admin → Pengaturan photobooth → "Unduh foto lewat QR".
   Antrean unggahnya ada di main/unggah.js, servernya di cloud/worker.mjs.
   ===================================================================== */

let unggahSt = { aktif: false, menunggu: 0, terkirim: 0, errorTerakhir: '' };

// Tampilkan QR + link di halaman Terima kasih (link sudah ada walau foto/video belum terunggah)
// jenis: 'foto' (photobooth) atau 'video' (pesan / quiz)
function tampilkanQR(link, jenis = 'foto') {
  const url = link + (bahasa === 'en' ? '?b=en' : '');
  try {
    gambarQR($('qrCanvas'), url, 8);
    const [judul, info] = $('thanksQR').querySelectorAll('b, small:not(.tk-link)');
    if (judul) judul.textContent = t(jenis === 'video' ? 'tk.qrVideo' : 'tk.qrFoto');
    if (info) info.textContent = t(jenis === 'video' ? 'tk.qrVideoInfo' : 'tk.qrFotoInfo');
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
  if (!s.aktif) {
    teks = "QR is off. Guests don't see a QR code.";
    warna = '';
  } else if (s.sedang && s.progres && s.progres.kode === s.sedang) {
    teks = `Sending video… part ${s.progres.n} of ${s.progres.total}${s.menungguVideo > 1 ? ` · ${s.menungguVideo} video(s) in queue` : ''}`;
    warna = 'kuning';
  } else if (s.sedang) {
    teks = `Sending… · ${s.menunggu + (s.menungguVideo || 0)} in queue`;
    warna = 'kuning';
  } else if (s.menunggu) {
    teks = `${s.menunggu} photo(s) waiting to be sent${s.errorTerakhir ? ' · ' + s.errorTerakhir : ''}`;
    warna = s.errorTerakhir ? 'merah' : 'kuning';
  } else if (s.menungguVideo && s.errorTerakhir && s.menungguVideo > (s.videoDiolah || 0)) {
    teks = `All photos sent · ${s.menungguVideo} video(s) waiting · ${s.errorTerakhir}`;
    warna = 'merah';
  } else {
    teks =
      `On · all photos sent${s.terkirim ? ` (${s.terkirim} since the app opened)` : ''}${s.menungguSatuan ? ` · ${s.menungguSatuan} single shot(s) still uploading` : ''}` +
      (s.menungguVideo
        ? ` · ${s.menungguVideo} video(s) ${s.videoDiolah === s.menungguVideo ? 'being prepared' : 'uploading'}`
        : s.terkirimVideo
          ? ` · ${s.terkirimVideo} video(s) sent`
          : '');
    warna = s.menungguVideo ? 'kuning' : 'hijau';
  }
  if (s.aktif && !s.video) teks += ' · Video QR is off';
  $('qrStatus').textContent = teks;
  $('qrDot').className = 'sony-dot ' + warna;
  $('btnQrUlang').style.display = (s.menunggu || s.menungguVideo > (s.videoDiolah || 0)) && !s.sedang ? '' : 'none';
  if ($('setQrVideo')) {
    $('setQrVideo').disabled = !s.aktif;
    $('setQrKualitas').disabled = !s.aktif || !s.video;
  }
}
async function isiUnduhQR() {
  try {
    unggahSt = await api.unggahStatus();
  } catch {
    return;
  }
  $('setQrAktif').checked = unggahSt.aktif;
  if ($('setQrVideo')) {
    $('setQrVideo').checked = unggahSt.video !== false;
    $('setQrKualitas').value = unggahSt.videoKualitas === '1080' ? '1080' : '720';
  }
  $('setQrUrl').value = unggahSt.url || '';
  $('setQrKunci').value = '';
  $('setQrKunci').placeholder = unggahSt.adaKunci ? '•••••••• (saved)' : 'From npm run cloud:pasang';
  $('btnQrPasang').style.display = unggahSt.adaHasilPasang ? '' : 'none';
  tulisStatusUnggah();
}
async function simpanUnduhQR(patch, pesan) {
  const r = await api.unggahSimpan(patch);
  unggahSt = r;
  if (r.error) {
    flash('qrMsg', r.error, true);
    $('setQrAktif').checked = r.aktif;
    if ($('setQrVideo')) $('setQrVideo').checked = r.video !== false;
    return false;
  }
  $('setQrKunci').value = '';
  $('setQrKunci').placeholder = r.adaKunci ? '•••••••• (saved)' : '';
  tulisStatusUnggah();
  if (pesan) flash('qrMsg', pesan);
  return true;
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
function pasangUnduhQR() {
  api.onUnggahStatus(s => {
    unggahSt = s;
    tulisStatusUnggah();
    if (current === 'riwayat') segarkanRiwayat();
  });
  $('setQrAktif').onchange = e =>
    simpanUnduhQR(
      { aktif: e.target.checked },
      e.target.checked ? 'QR is on: photo booth guests will see a QR code on the Thank you page.' : 'QR turned off.',
    );
  if ($('setQrVideo')) {
    $('setQrVideo').onchange = e =>
      simpanUnduhQR(
        { video: e.target.checked },
        e.target.checked
          ? 'Video QR is on: guests who record a message or quiz get a QR for their video.'
          : 'Video QR turned off. Photos still get a QR.',
      );
    $('setQrKualitas').onchange = e =>
      simpanUnduhQR(
        { videoKualitas: e.target.value },
        e.target.value === '1080'
          ? 'Phone videos: 1080p (sharper, about 2× larger to upload).'
          : 'Phone videos: 720p (lighter, uploads faster).',
      );
  }
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
    if (
      await simpanUnduhQR(
        { url: h.url, kunci: h.kunci },
        'Address & key loaded from the setup. Press "Test connection", then turn the QR on.',
      )
    )
      $('setQrUrl').value = h.url;
  };
  $('btnQrUlang').onclick = async () => {
    unggahSt = await api.unggahCobaSekarang();
    tulisStatusUnggah();
  };
}
