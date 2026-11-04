/* =====================================================================
   pengaturan-booth.js — halaman Pengaturan videobooth & Pengaturan
   photobooth (dibuka dari Admin). Setiap pilihan langsung tersimpan dan
   berlaku. Nilai & batasnya dijaga di main/pengaturan.js.
   ===================================================================== */

const PILIHAN = {
  pesanCountdown:  [[0, 'Langsung merekam'], [3, '3 detik'], [5, '5 detik'], [10, '10 detik']],
  pesanMaxSeconds: [[0, 'Tanpa batas'], [30, '30 detik'], [60, '1 menit'], [120, '2 menit'], [180, '3 menit'], [300, '5 menit']],
  photoCountdown:  [[3, '3 detik'], [5, '5 detik'], [7, '7 detik'], [10, '10 detik']],
  photoPreview:    [[0, 'Tanpa pratinjau'], [1, '1 detik'], [2, '2 detik'], [3, '3 detik']],
};
const labelDari = key => v => (PILIHAN[key].find(([n]) => n === v) || [v, secLabel(v)])[1];

function isiPengaturanBooth(s) {
  // Videobooth
  fillSelect($('setPesanCountdown'), PILIHAN.pesanCountdown.map(p => p[0]), s.pesanCountdown, labelDari('pesanCountdown'));
  fillSelect($('setPesanMax'), PILIHAN.pesanMaxSeconds.map(p => p[0]), s.pesanMaxSeconds, labelDari('pesanMaxSeconds'));
  fillSelect($('setSeconds'), SECONDS, s.quizSeconds, secLabel);
  fillSelect($('setRounds'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], s.quizRounds, v => `${v} pertanyaan`);
  // Photobooth
  fillSelect($('setPhotoCountdown'), PILIHAN.photoCountdown.map(p => p[0]), s.photoCountdown, labelDari('photoCountdown'));
  fillSelect($('setPhotoPreview'), PILIHAN.photoPreview.map(p => p[0]), s.photoPreview, labelDari('photoPreview'));
  $('setPhotoFlash').checked = s.photoFlash;
}
async function bukaPengaturanBooth(layar) {
  show(layar);
  const s = await api.getSettings();
  normalisasiCfg(s); isiPengaturanBooth({ ...s, ...cfg });
}
async function simpanBooth(patch, msgId, msg) {
  const s = await api.saveSettings(patch);
  applySettings(s);
  isiPengaturanBooth({ ...s, ...cfg });
  if (s.error) flash(msgId, s.error, true); else flash(msgId, msg);
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
function pasangPengaturanBooth() {
  $('btnSetVideo').onclick = () => bukaPengaturanBooth('setvideo');
  $('btnSetPhoto').onclick = () => bukaPengaturanBooth('setphoto');
  $('btnSetVideoBack').onclick = () => show('admin');
  $('btnSetPhotoBack').onclick = () => show('admin');

  const saklar = (id, key, nama) => { $(id).onchange = e => {
    const msgId = key === 'enablePhoto' || key === 'photoFlash' ? 'setPhotoMsg' : 'setVideoMsg';
    simpanBooth({ [key]: e.target.checked }, msgId, `${nama} ${e.target.checked ? 'aktif' : 'dimatikan'}.`);
  }; };
  saklar('setPhotoFlash', 'photoFlash', 'Efek kilat');

  const pilih = (id, key, msgId, teks) => { $(id).onchange = e => {
    const v = Number(e.target.value);
    simpanBooth({ [key]: v }, msgId, teks(v));
  }; };
  pilih('setPesanCountdown', 'pesanCountdown', 'setVideoMsg', v => `Hitung mundur pesan: ${labelDari('pesanCountdown')(v).toLowerCase()}.`);
  pilih('setPesanMax', 'pesanMaxSeconds', 'setVideoMsg', v => `Batas durasi pesan: ${labelDari('pesanMaxSeconds')(v).toLowerCase()}.`);
  pilih('setSeconds', 'quizSeconds', 'setVideoMsg', v => `Waktu jawab: ${secLabel(v)}.`);
  pilih('setRounds', 'quizRounds', 'setVideoMsg', v => `Jumlah soal per sesi: ${v}.`);
  pilih('setPhotoCountdown', 'photoCountdown', 'setPhotoMsg', v => `Hitung mundur foto: ${labelDari('photoCountdown')(v)}.`);
  pilih('setPhotoPreview', 'photoPreview', 'setPhotoMsg', v => `Pratinjau: ${labelDari('photoPreview')(v).toLowerCase()}.`);
}
