/* =====================================================================
   pengaturan-booth.js — halaman Pengaturan videobooth & Pengaturan
   photobooth (dibuka dari Admin). Setiap pilihan langsung tersimpan dan
   berlaku. Nilai & batasnya dijaga di main/pengaturan.js.
   ===================================================================== */

const PILIHAN = {
  pesanCountdown: [
    [0, 'Record right away'],
    [3, '3 seconds'],
    [5, '5 seconds'],
    [10, '10 seconds'],
  ],
  pesanMaxSeconds: [
    [0, 'No limit'],
    [30, '30 seconds'],
    [60, '1 minute'],
    [120, '2 minutes'],
    [180, '3 minutes'],
    [300, '5 minutes'],
  ],
  photoCountdown: [
    [3, '3 seconds'],
    [5, '5 seconds'],
    [7, '7 seconds'],
    [10, '10 seconds'],
  ],
  photoPreview: [
    [0, 'No preview'],
    [1, '1 second'],
    [2, '2 seconds'],
    [3, '3 seconds'],
  ],
};
const labelDari = key => v => (PILIHAN[key].find(([n]) => n === v) || [v, secLabel(v)])[1];

function isiPengaturanBooth(s) {
  // Videobooth
  fillSelect(
    $('setPesanCountdown'),
    PILIHAN.pesanCountdown.map(p => p[0]),
    s.pesanCountdown,
    labelDari('pesanCountdown'),
  );
  fillSelect(
    $('setPesanMax'),
    PILIHAN.pesanMaxSeconds.map(p => p[0]),
    s.pesanMaxSeconds,
    labelDari('pesanMaxSeconds'),
  );
  fillSelect($('setSeconds'), SECONDS, s.quizSeconds, secLabel);
  fillSelect($('setRounds'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], s.quizRounds, v => `${v} pertanyaan`);
  // Photobooth
  fillSelect(
    $('setPhotoCountdown'),
    PILIHAN.photoCountdown.map(p => p[0]),
    s.photoCountdown,
    labelDari('photoCountdown'),
  );
  fillSelect(
    $('setPhotoPreview'),
    PILIHAN.photoPreview.map(p => p[0]),
    s.photoPreview,
    labelDari('photoPreview'),
  );
  $('setPhotoFlash').checked = s.photoFlash;
}
async function bukaPengaturanBooth(layar) {
  show(layar);
  const s = await api.getSettings();
  normalisasiCfg(s);
  isiPengaturanBooth({ ...s, ...cfg });
  if (layar === 'setphoto') fillDownloadQrSettings();
}
async function simpanBooth(patch, msgId, msg) {
  const s = await api.saveSettings(patch);
  applySettings(s);
  isiPengaturanBooth({ ...s, ...cfg });
  if (s.error) flash(msgId, s.error, true);
  else flash(msgId, msg);
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari start.js)
function pasangPengaturanBooth() {
  $('btnSetVideo').onclick = () => bukaPengaturanBooth('setvideo');
  $('btnSetPhoto').onclick = () => bukaPengaturanBooth('setphoto');
  $('btnSetVideoBack').onclick = () => show('admin');
  $('btnSetPhotoBack').onclick = () => show('admin');

  const saklar = (id, key, nama) => {
    $(id).onchange = e => {
      const msgId = key === 'enablePhoto' || key === 'photoFlash' ? 'setPhotoMsg' : 'setVideoMsg';
      simpanBooth({ [key]: e.target.checked }, msgId, `${nama} ${e.target.checked ? 'on' : 'off'}.`);
    };
  };
  saklar('setPhotoFlash', 'photoFlash', 'Screen flash');

  const pilih = (id, key, msgId, teks) => {
    $(id).onchange = e => {
      const v = Number(e.target.value);
      simpanBooth({ [key]: v }, msgId, teks(v));
    };
  };
  pilih(
    'setPesanCountdown',
    'pesanCountdown',
    'setVideoMsg',
    v => `Message countdown: ${labelDari('pesanCountdown')(v).toLowerCase()}.`,
  );
  pilih(
    'setPesanMax',
    'pesanMaxSeconds',
    'setVideoMsg',
    v => `Message time limit: ${labelDari('pesanMaxSeconds')(v).toLowerCase()}.`,
  );
  pilih('setSeconds', 'quizSeconds', 'setVideoMsg', v => `Answer time: ${secLabel(v)}.`);
  pilih('setRounds', 'quizRounds', 'setVideoMsg', v => `Questions per session: ${v}.`);
  pilih(
    'setPhotoCountdown',
    'photoCountdown',
    'setPhotoMsg',
    v => `Photo countdown: ${labelDari('photoCountdown')(v)}.`,
  );
  pilih(
    'setPhotoPreview',
    'photoPreview',
    'setPhotoMsg',
    v => `Preview: ${labelDari('photoPreview')(v).toLowerCase()}.`,
  );
}
