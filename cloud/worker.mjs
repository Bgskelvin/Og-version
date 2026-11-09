/* =====================================================================
   worker.mjs — server kecil di Cloudflare untuk unduh foto lewat QR.
   Dipasang dengan:  npm run cloud:pasang   (lihat cloud/pasang.sh)

   PUT  /u/<kode>       booth mengunggah foto hasil (dengan template) — wajib kunci booth
                        header opsional: x-leura-couple (nama couple), x-leura-jumlah (jumlah foto satuan 0-4)
   PUT  /u/<kode>/<n>   booth mengunggah foto satuan ke-n (1-4)       — wajib kunci booth
   GET  /f/<kode>       halaman unduh untuk tamu (yang dibuka dari QR)
   GET  /s/<kode>       status JSON: foto mana yang sudah ada (dipakai halaman unduh)
   GET  /i/<kode>[/<n>] gambar foto (hasil / satuan)
   GET  /d/<kode>[/<n>] unduh file foto
   GET  /ping           cek sambungan dari Admin (wajib kunci booth)

   Video (pesan & quiz) — diunggah per bagian (R2 multipart), wajib kunci booth:
   PUT  /uv/<kode>/poster        gambar sampul (JPEG)
   POST /uv/<kode>/mulai         mulai unggah → { uploadId }   (header x-leura-couple, x-leura-jenis, x-leura-ukuran)
   PUT  /uv/<kode>/<n>?u=<id>    bagian ke-n (1..) → { etag }
   POST /uv/<kode>/selesai?u=<id> { bagian: [{ partNumber, etag }] }
   GET  /v/<kode>       halaman video untuk tamu (pemutar + Simpan video)
   GET  /vs/<kode>      status JSON video
   GET  /vf/<kode>      file video (mendukung Range, untuk diputar di HP)
   GET  /vd/<kode>      unduh file video
   GET  /vp/<kode>      gambar sampul

   Foto disimpan di R2 (binding FOTO) dan dianggap hilang setelah
   HARI_SIMPAN hari; aturan R2 menghapus file aslinya otomatis.
   ===================================================================== */

const KODE = /^[A-Za-z0-9]{8,16}$/;
const MAKS_BYTE = 15 * 1024 * 1024;
const MAKS_SATUAN = 4;
const MAKS_BAGIAN_BYTE = 9 * 1024 * 1024; // booth mengirim bagian 8 MB
const MAKS_BAGIAN = 250; // ±2 GB per video
const MAKS_POSTER = 3 * 1024 * 1024;

const TEKS = {
  id: {
    lang: 'id',
    judul: 'Foto Photo Booth',
    siap: 'Fotomu sudah siap',
    simpanSemua: 'Simpan semua foto',
    simpanSemuaN: 'Simpan semua ({n} foto)',
    simpanIni: 'Simpan',
    simpanTemplate: 'Simpan foto template saja',
    simpanSatu: 'Simpan foto ini',
    fotoTemplate: 'Foto dengan template',
    fotoSatuan: 'Foto satuan',
    ketukLihat: 'Ketuk foto untuk melihat lebih besar',
    menyusul: 'Sedang dikirim…',
    menyusulInfo: 'Foto satuan sedang menyusul. Halaman ini akan memperbarui sendiri.',
    tersedia: 'Tersedia sampai {t}',
    bagikan: 'Bagikan link',
    disalin: 'Link disalin',
    tipsIos: 'Tekan "Simpan semua", lalu pilih "Simpan Gambar" supaya foto masuk ke galeri.',
    tipsLain: 'Foto tersimpan di folder Unduhan.',
    memuat: 'Menyiapkan foto…',
    gagal: 'Gagal menyimpan. Coba tekan lagi.',
    tersimpan: 'Tersimpan',
    tutup: 'Tutup',
    sebelum: 'Sebelumnya',
    berikut: 'Berikutnya',
    tunggu: 'Fotomu sedang dikirim…',
    tungguInfo: 'Halaman ini akan memuat ulang sendiri. Biasanya hanya beberapa detik.',
    hilang: 'Foto tidak ditemukan',
    hilangInfo:
      'Foto disimpan selama {h} hari setelah diambil. Kalau kamu baru saja berfoto, tunggu sebentar dan buka lagi link ini.',
    simpanHari: 'Foto tersedia {h} hari.',
    foto: 'Foto',
    vJudul: 'Video Leura',
    vSiap: 'Videomu sudah siap',
    vPesan: 'Pesan video',
    vQuiz: 'Quick quiz',
    vSimpan: 'Simpan video',
    vMemuat: 'Menyiapkan video… {p}%',
    vTipsIos: 'Tekan "Simpan video", lalu pilih "Simpan Video" supaya masuk ke galeri.',
    vTipsLain: 'Video tersimpan di folder Unduhan.',
    vTersimpan: 'Video tersimpan',
    vTunggu: 'Videomu sedang disiapkan…',
    vTungguInfo:
      'Video diproses dan dikirim dari booth, biasanya 1 sampai 3 menit. Halaman ini akan terbuka sendiri saat videonya siap.',
    vLama: 'Videonya belum sampai. Booth mungkin sedang tidak tersambung internet — coba buka lagi link ini nanti.',
    vHilang: 'Video tidak ditemukan',
    vHilangInfo: 'Video disimpan selama {h} hari setelah direkam.',
    vPutar: 'Putar video',
  },
  en: {
    lang: 'en',
    judul: 'Photo Booth photos',
    siap: 'Your photos are ready',
    simpanSemua: 'Save all photos',
    simpanSemuaN: 'Save all ({n} photos)',
    simpanIni: 'Save',
    simpanTemplate: 'Save template photo only',
    simpanSatu: 'Save this photo',
    fotoTemplate: 'Photo with template',
    fotoSatuan: 'Single shots',
    ketukLihat: 'Tap a photo to see it bigger',
    menyusul: 'On its way…',
    menyusulInfo: 'Your single shots are still uploading. This page updates by itself.',
    tersedia: 'Available until {t}',
    bagikan: 'Share link',
    disalin: 'Link copied',
    tipsIos: 'Tap "Save all", then choose "Save Images" to put the photos in your gallery.',
    tipsLain: 'Photos are saved to your Downloads folder.',
    memuat: 'Preparing photos…',
    gagal: "Couldn't save. Please try again.",
    tersimpan: 'Saved',
    tutup: 'Close',
    sebelum: 'Previous',
    berikut: 'Next',
    tunggu: 'Your photo is on its way…',
    tungguInfo: 'This page will refresh by itself. It usually takes just a few seconds.',
    hilang: 'Photo not found',
    hilangInfo:
      'Photos are kept for {h} days after they are taken. If you just took your photo, please wait a moment and open this link again.',
    simpanHari: 'Available for {h} days.',
    foto: 'Photo',
    vJudul: 'Leura video',
    vSiap: 'Your video is ready',
    vPesan: 'Video message',
    vQuiz: 'Quick quiz',
    vSimpan: 'Save video',
    vMemuat: 'Preparing video… {p}%',
    vTipsIos: 'Tap "Save video", then choose "Save Video" to put it in your gallery.',
    vTipsLain: 'The video is saved to your Downloads folder.',
    vTersimpan: 'Video saved',
    vTunggu: 'Your video is being prepared…',
    vTungguInfo:
      'The booth processes and sends the video, usually within 1 to 3 minutes. This page opens by itself when it is ready.',
    vLama: "The video hasn't arrived yet. The booth may be offline — please open this link again later.",
    vHilang: 'Video not found',
    vHilangInfo: 'Videos are kept for {h} days after they are recorded.',
    vPutar: 'Play video',
  },
};

const kunciFoto = (kode, n) => (n ? `foto/${kode}-${n}.jpg` : `foto/${kode}.jpg`);
const hariSimpan = env => Math.max(1, Number(env.HARI_SIMPAN) || 7);
const waktuUnggah = obj =>
  Number(obj.customMetadata && obj.customMetadata.diunggah) ||
  (obj.uploaded ? new Date(obj.uploaded).getTime() : Date.now());
const kedaluwarsa = (obj, env) => Date.now() - waktuUnggah(obj) > hariSimpan(env) * 86400000;
// Bandingkan kunci tanpa bocor lewat waktu proses
function samaAman(a, b) {
  a = String(a || '');
  b = String(b || '');
  let beda = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) beda |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return beda === 0 && a.length > 0;
}
const bolehBooth = (req, env) =>
  samaAman((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), env.KUNCI_BOOTH);
const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const HEADER_AMAN = {
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...HEADER_AMAN },
  });
// Karakter kontrol & < > dibuang dari nama couple
// eslint-disable-next-line no-control-regex -- sengaja mencari karakter kontrol
const KARAKTER_TERLARANG = /[\u0000-\u001f<>]/g;
const namaCouple = v => {
  try {
    return decodeURIComponent(String(v || ''))
      .replace(KARAKTER_TERLARANG, '')
      .trim()
      .slice(0, 80);
  } catch {
    return '';
  }
};
// Nama file unduhan: "Rina-Dimas_foto-1.jpg" (huruf aman saja)
const namaFile = (couple, kode, n) =>
  `${
    (couple || 'Leura')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'Leura'
  }_${n ? 'foto-' + n : 'template'}_${kode.slice(0, 4)}.jpg`;

const kunciVideo = kode => `video/${kode}.mp4`;
const kunciPoster = kode => `video/${kode}.jpg`;
const namaFileVideo = (couple, kode, jenis) =>
  `${
    (couple || 'Leura')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'Leura'
  }_${jenis === 'quiz' ? 'quiz' : 'pesan'}_${kode.slice(0, 4)}.mp4`;
async function infoVideo(env, kode) {
  if (!KODE.test(kode)) return null;
  const obj = await env.FOTO.head(kunciVideo(kode));
  if (!obj || kedaluwarsa(obj, env)) return null;
  const m = obj.customMetadata || {};
  return {
    obj,
    couple: m.couple || '',
    jenis: m.jenis === 'quiz' ? 'quiz' : 'pesan',
    ukuran: obj.size,
    poster: !!(await env.FOTO.head(kunciPoster(kode))),
    sampai: waktuUnggah(obj) + hariSimpan(env) * 86400000,
  };
}
// "bytes=a-b" / "bytes=a-" / "bytes=-n" → { offset, length } (null kalau tidak ada/tidak valid)
function bacaRange(h, ukuran) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(h || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let a, b;
  if (m[1] === '') {
    const n = Number(m[2]);
    a = Math.max(0, ukuran - n);
    b = ukuran - 1;
  } else {
    a = Number(m[1]);
    b = m[2] === '' ? ukuran - 1 : Math.min(Number(m[2]), ukuran - 1);
  }
  if (a >= ukuran || b < a) return { salah: true };
  return { offset: a, length: b - a + 1 };
}

async function ambil(env, kode, n) {
  if (!KODE.test(kode)) return null;
  const obj = await env.FOTO.get(kunciFoto(kode, n));
  if (!obj) return null;
  if (kedaluwarsa(obj, env)) return null;
  return obj;
}
// Foto satuan mana yang sudah sampai
async function cekSatuan(env, kode, jumlah) {
  const ada = await Promise.all(
    Array.from({ length: jumlah }, (_, i) =>
      env.FOTO.head ? env.FOTO.head(kunciFoto(kode, i + 1)) : env.FOTO.get(kunciFoto(kode, i + 1)),
    ),
  );
  return ada.map((x, i) => (x ? i + 1 : 0)).filter(Boolean);
}
async function statusFoto(env, kode) {
  const obj = await ambil(env, kode);
  if (!obj) return null;
  const m = obj.customMetadata || {};
  const jumlah = Math.min(MAKS_SATUAN, Math.max(0, Number(m.jumlah) || 0));
  return {
    couple: m.couple || '',
    jumlah,
    ada: jumlah ? await cekSatuan(env, kode, jumlah) : [],
    sampai: waktuUnggah(obj) + hariSimpan(env) * 86400000,
  };
}

const GAYA = `
:root{--bg:#F6F1EA;--kartu:#fff;--teks:#1D1D1F;--abu:#6E6E73;--garis:rgba(0,0,0,.08);--aksen:#B08D57;--aksen2:#9A7745;--isi:rgba(0,0,0,.05)}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--kartu:#1E1E20;--teks:#F5F5F7;--abu:#A1A1A6;--garis:rgba(255,255,255,.1);--isi:rgba(255,255,255,.07)}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{background:var(--bg)}
body{margin:0;min-height:100vh;color:var(--teks);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
 background:radial-gradient(80% 50% at 10% 0%,rgba(176,141,87,.16),transparent 70%),radial-gradient(70% 45% at 100% 10%,rgba(214,150,170,.14),transparent 70%),var(--bg);
 display:flex;justify-content:center;padding:max(20px,env(safe-area-inset-top)) 16px max(28px,env(safe-area-inset-bottom))}
main{width:100%;max-width:560px}
.merek{letter-spacing:.34em;font-size:12px;font-weight:700;color:var(--aksen);text-align:center;margin:6px 0 10px}
h1{font:600 30px/1.15 Georgia,"Times New Roman",serif;letter-spacing:-.01em;text-align:center;margin:0}
.sub{color:var(--abu);text-align:center;margin:6px 0 20px;font-size:15px}
.kartu{background:var(--kartu);border-radius:22px;padding:10px;box-shadow:0 1px 2px rgba(0,0,0,.05),0 18px 44px rgba(40,30,20,.12)}
.hero{position:relative;display:block;width:100%;border:0;padding:0;background:none;cursor:zoom-in;border-radius:14px;overflow:hidden}
.hero img{display:block;width:100%;height:auto;border-radius:14px;background:var(--isi)}
.label{position:absolute;left:10px;top:10px;padding:5px 10px;border-radius:999px;font-size:12px;font-weight:600;color:#fff;background:rgba(0,0,0,.42);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:56px;margin:0;padding:0 20px;border:0;border-radius:999px;
 font-weight:600;font-size:17px;line-height:1;font-family:inherit;cursor:pointer;text-decoration:none;transition:transform .15s ease,background .2s ease,opacity .2s}
.btn:active{transform:scale(.98)}
.btn svg{width:22px;height:22px;flex:none}
.utama{background:var(--aksen);color:#fff;box-shadow:0 10px 24px rgba(176,141,87,.35)}
.utama:hover{background:var(--aksen2)}
.kedua{background:var(--isi);color:var(--teks)}
.aksi{display:grid;gap:10px;margin:16px 0 6px}
.btn[disabled]{opacity:.6;pointer-events:none}
h2{font-size:15px;font-weight:600;margin:26px 4px 10px;display:flex;justify-content:space-between;align-items:baseline}
h2 small{font-weight:400;color:var(--abu);font-size:13px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sel{position:relative;border:0;padding:0;border-radius:16px;overflow:hidden;background:var(--isi);aspect-ratio:3/2;cursor:zoom-in}
.sel .isi{position:absolute;inset:0;border:0;padding:0;margin:0;background:none;cursor:zoom-in}
.sel img{width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .4s ease}
.sel img.ok{opacity:1}
.sel .unduh{position:absolute;right:8px;bottom:8px;width:38px;height:38px;border-radius:50%;border:0;display:grid;place-items:center;
 background:rgba(255,255,255,.92);color:#1D1D1F;box-shadow:0 4px 12px rgba(0,0,0,.18);cursor:pointer}
.sel .unduh svg{width:18px;height:18px}
.sel .no{position:absolute;left:8px;top:8px;min-width:24px;height:24px;padding:0 7px;border-radius:999px;font-size:12px;font-weight:700;line-height:24px;text-align:center;color:#fff;background:rgba(0,0,0,.42)}
.tunggu{background:linear-gradient(100deg,var(--isi) 30%,rgba(255,255,255,.35) 50%,var(--isi) 70%) var(--isi);background-size:250% 100%;animation:kilau 1.6s linear infinite;cursor:default;display:grid;place-items:center}
.tunggu span{font-size:13px;color:var(--abu)}
@keyframes kilau{from{background-position:100% 0}to{background-position:-150% 0}}
.info{color:var(--abu);font-size:14px;text-align:center;margin:18px 6px 0}
.kaki{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:18px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:999px;border:0;background:var(--isi);color:var(--teks);font-weight:500;font-size:14px;line-height:1;font-family:inherit;cursor:pointer}
.chip svg{width:16px;height:16px}
.toast{position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translate(-50%,20px);opacity:0;pointer-events:none;
 padding:12px 18px;border-radius:999px;background:rgba(29,29,31,.92);color:#fff;font-size:15px;font-weight:500;transition:.25s ease;z-index:30;white-space:nowrap}
.toast.on{opacity:1;transform:translate(-50%,0)}
.lb{position:fixed;inset:0;z-index:20;background:#0B0B0D;display:none;flex-direction:column;touch-action:none}
.lb.on{display:flex}
.lb-atas{display:flex;justify-content:space-between;align-items:center;padding:max(14px,env(safe-area-inset-top)) 16px 10px;color:#fff;font-size:15px;font-weight:600}
.lb-tutup{width:40px;height:40px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;display:grid;place-items:center;cursor:pointer}
.lb-tutup svg{width:20px;height:20px}
.lb-rel{flex:1;position:relative;overflow:hidden}
.lb-jalur{position:absolute;inset:0;display:flex;transition:transform .32s cubic-bezier(.2,.8,.2,1)}
.lb-hal{flex:0 0 100%;display:grid;place-items:center;padding:8px 16px}
.lb-hal img{max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.5);user-select:none;-webkit-user-drag:none}
.lb-panah{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;display:none;place-items:center;cursor:pointer}
.lb-panah svg{width:22px;height:22px}
@media (hover:hover){.lb-panah{display:grid}}
.lb-kiri{left:14px}.lb-kanan{right:14px}
.lb-bawah{padding:12px 16px max(18px,env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:12px}
.lb-titik{display:flex;gap:6px}.lb-titik i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.3);transition:.2s}.lb-titik i.on{background:#fff;width:18px;border-radius:4px}
.lb-bawah .btn{max-width:420px}
.muncul{animation:muncul .6s cubic-bezier(.2,.8,.2,1) both}
@keyframes muncul{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
.kilap{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:5}
.kilap i{position:absolute;top:-12px;width:8px;height:12px;border-radius:2px;opacity:.9;animation:jatuh 2.4s ease-in forwards}
@keyframes jatuh{to{transform:translate(var(--x),105vh) rotate(var(--r));opacity:0}}
@media (prefers-reduced-motion:reduce){.muncul,.kilap i,.tunggu{animation:none}.lb-jalur{transition:none}}
.vbox{position:relative;border-radius:14px;overflow:hidden;background:#000}
.vbox video{display:block;width:100%;max-height:72vh;background:#000}
.vbox .label{pointer-events:none}
.putar{width:40px;height:40px;margin:30px auto;border-radius:50%;border:4px solid var(--aksen);border-right-color:transparent;animation:p 1s linear infinite}
@keyframes p{to{transform:rotate(360deg)}}
p{margin:8px 0}
`;

function halaman(t, isi, skrip = '') {
  return new Response(
    `<!doctype html><html lang="${t.lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#F6F1EA"><title>${esc(t.judul)}</title><style>${GAYA}</style></head>
<body><main><div class="merek">LEURA</div>${isi}</main>${skrip}</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...HEADER_AMAN } },
  );
}

const IKON = {
  unduh:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/></svg>',
  bagikan:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M8 7.5l4-4 4 4M6 11v8.5h12V11"/></svg>',
  tutup:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  kiri: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>',
  kanan:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg>',
};

// Halaman unduh: foto template besar, foto satuan di bawahnya, lihat besar (geser), simpan satu / semua
function halamanUnduh(t, kode, s, bahasa) {
  const tgl = new Date(s.sampai).toLocaleDateString(bahasa === 'en' ? 'en-GB' : 'id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Makassar',
  });
  const total = 1 + s.jumlah;
  const data = {
    kode,
    jumlah: s.jumlah,
    ada: s.ada,
    couple: s.couple,
    t,
    bahasa,
    nama: [namaFile(s.couple, kode, 0), ...Array.from({ length: s.jumlah }, (_, i) => namaFile(s.couple, kode, i + 1))],
  };
  const satuan = s.jumlah
    ? `<h2>${esc(t.fotoSatuan)} <small>${esc(t.ketukLihat)}</small></h2>
<div class="grid" id="grid">${Array.from({ length: s.jumlah }, (_, i) => `<div class="sel tunggu muncul" style="animation-delay:${120 + i * 70}ms" data-n="${i + 1}"><span>${esc(t.menyusul)}</span></div>`).join('')}</div>`
    : '';
  const isi = `<h1 class="muncul">${esc(s.couple || t.siap)}</h1>
<p class="sub muncul" style="animation-delay:60ms">${esc(s.couple ? t.siap : t.judul)} ✨</p>
<div class="kartu muncul" style="animation-delay:120ms"><button class="hero" id="hero" aria-label="${esc(t.fotoTemplate)}"><img src="/i/${kode}" alt="${esc(t.fotoTemplate)}" fetchpriority="high"><span class="label">${esc(t.fotoTemplate)}</span></button></div>
<div class="aksi muncul" style="animation-delay:180ms">
  <button class="btn utama" id="semua">${IKON.unduh}<span>${esc(total > 1 ? t.simpanSemuaN.replace('{n}', total) : t.simpanSatu)}</span></button>
  ${total > 1 ? `<button class="btn kedua" id="satuTpl">${esc(t.simpanTemplate)}</button>` : ''}
</div>
${satuan}
<p class="info" id="tips"></p>
<p class="info">${esc(t.tersedia.replace('{t}', tgl))}</p>
<div class="kaki"><button class="chip" id="bagikan">${IKON.bagikan}${esc(t.bagikan)}</button></div>
<div class="lb" id="lb" role="dialog" aria-modal="true">
  <div class="lb-atas"><span id="lbNo"></span><button class="lb-tutup" id="lbTutup" aria-label="${esc(t.tutup)}">${IKON.tutup}</button></div>
  <div class="lb-rel" id="lbRel"><div class="lb-jalur" id="lbJalur"></div>
    <button class="lb-panah lb-kiri" id="lbKiri" aria-label="${esc(t.sebelum)}">${IKON.kiri}</button>
    <button class="lb-panah lb-kanan" id="lbKanan" aria-label="${esc(t.berikut)}">${IKON.kanan}</button></div>
  <div class="lb-bawah"><div class="lb-titik" id="lbTitik"></div><button class="btn utama" id="lbSimpan">${IKON.unduh}<span>${esc(t.simpanIni)}</span></button></div>
</div>
<div class="toast" id="toast" role="status"></div><div class="kilap" id="kilap" aria-hidden="true"></div>`;
  const skrip = `<script>const D=${JSON.stringify(data).replace(/</g, '\\u003c')};${SKRIP_UNDUH}</script>`;
  return halaman(t, isi, skrip);
}

// Halaman video: pemutar, Simpan video (ke galeri lewat menu bagikan), Bagikan link
function halamanVideo(t, kode, v, bahasa) {
  const tgl = new Date(v.sampai).toLocaleDateString(bahasa === 'en' ? 'en-GB' : 'id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Makassar',
  });
  const label = v.jenis === 'quiz' ? t.vQuiz : t.vPesan;
  const data = { kode, couple: v.couple, nama: namaFileVideo(v.couple, kode, v.jenis), ukuran: v.ukuran, t };
  const isi = `<h1 class="muncul">${esc(v.couple || t.vSiap)}</h1>
<p class="sub muncul" style="animation-delay:60ms">${esc(v.couple ? t.vSiap : t.vJudul)} ✨</p>
<div class="kartu muncul" style="animation-delay:120ms"><div class="vbox"><video id="vid" controls playsinline preload="metadata" ${v.poster ? `poster="/vp/${kode}"` : ''} src="/vf/${kode}"></video><span class="label">${esc(label)}</span></div></div>
<div class="aksi muncul" style="animation-delay:180ms">
  <button class="btn utama" id="simpan">${IKON.unduh}<span>${esc(t.vSimpan)}</span></button>
</div>
<p class="info" id="tips"></p>
<p class="info">${esc(t.tersedia.replace('{t}', tgl))} · ${(v.ukuran / 1048576).toFixed(v.ukuran < 10485760 ? 1 : 0)} MB</p>
<div class="kaki"><button class="chip" id="bagikan">${IKON.bagikan}${esc(t.bagikan)}</button></div>
<div class="toast" id="toast" role="status"></div><div class="kilap" id="kilap" aria-hidden="true"></div>`;
  return halaman(
    { ...t, judul: t.vJudul },
    isi,
    `<script>const D=${JSON.stringify(data).replace(/</g, '\\u003c')};${SKRIP_VIDEO}</script>`,
  );
}
const SKRIP_VIDEO = `
(function(){
var $=function(id){return document.getElementById(id)},T=D.t;
var ios=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1),hp=ios||/Android/.test(navigator.userAgent);
var bisaBagi=!!(navigator.canShare&&hp&&D.ukuran<300*1048576);
var toastT;function toast(m){var e=$('toast');e.textContent=m;e.classList.add('on');clearTimeout(toastT);toastT=setTimeout(function(){e.classList.remove('on')},2400)}
$('tips').textContent=bisaBagi&&ios?T.vTipsIos:'';
(function(){if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;var k=$('kilap'),w=['#B08D57','#E7C9A0','#F2B8C6','#FFFFFF','#D9B26F'];
for(var i=0;i<22;i++){var e=document.createElement('i');e.style.left=Math.random()*100+'%';e.style.background=w[i%w.length];
e.style.setProperty('--x',(Math.random()*80-40)+'px');e.style.setProperty('--r',(Math.random()*540-270)+'deg');e.style.animationDelay=(Math.random()*.6)+'s';e.style.animationDuration=(1.8+Math.random()*1.4)+'s';k.appendChild(e)}
setTimeout(function(){k.remove()},4200)})();
function unduhBiasa(){var a=document.createElement('a');a.href='/vd/'+D.kode;a.download=D.nama;document.body.appendChild(a);a.click();a.remove()}
// Ambil file sambil menampilkan persen (video bisa puluhan MB)
function ambil(lbl){return fetch('/vf/'+D.kode).then(function(r){if(!r.ok)throw new Error(r.status);
 var total=+r.headers.get('content-length')||D.ukuran;if(!r.body||!r.body.getReader)return r.blob();
 var rd=r.body.getReader(),bag=[],dapat=0;
 return (function baca(){return rd.read().then(function(x){if(x.done)return new Blob(bag,{type:'video/mp4'});bag.push(x.value);dapat+=x.value.length;
  lbl.textContent=T.vMemuat.replace('{p}',Math.min(99,Math.round(dapat/total*100)));return baca()})})()})}
var sibuk=false;
$('simpan').onclick=function(){if(sibuk)return;var b=$('simpan'),lbl=b.querySelector('span'),lama=lbl.textContent;
 if(!bisaBagi){unduhBiasa();toast('✓ '+T.vTipsLain);return}
 sibuk=true;b.disabled=true;lbl.textContent=T.vMemuat.replace('{p}',0);
 var beres=function(){sibuk=false;b.disabled=false;lbl.textContent=lama};
 ambil(lbl).then(function(blob){var f=new File([blob],D.nama,{type:'video/mp4'});
  if(!navigator.canShare({files:[f]}))throw new Error('tidak bisa');
  lbl.textContent=lama;b.disabled=false;
  return navigator.share({files:[f]}).then(function(){beres();toast('✓ '+T.vTersimpan)},function(e){beres();if(e&&e.name!=='AbortError')toast(T.gagal)})
 }).catch(function(){beres();unduhBiasa();toast('✓ '+T.vTipsLain)})};
$('bagikan').onclick=function(){var u=location.origin+location.pathname+location.search;
 if(navigator.share)navigator.share({url:u,title:D.couple||T.vJudul}).catch(function(){});
 else if(navigator.clipboard)navigator.clipboard.writeText(u).then(function(){toast('✓ '+T.disalin)});};
})();`;

// Skrip halaman unduh (dijalankan di HP tamu)
const SKRIP_UNDUH = `
(function(){
var $=function(id){return document.getElementById(id)},T=D.t,ikonUnduh=$('semua').querySelector('svg').outerHTML;
var ios=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
var ada=D.ada.slice();                               // foto satuan yang sudah sampai
var urlFoto=function(n){return '/i/'+D.kode+(n?'/'+n:'')};
var daftar=function(){return [0].concat(ada.slice().sort(function(a,b){return a-b}))};   // 0 = foto template
var toastT;function toast(m){var e=$('toast');e.textContent=m;e.classList.add('on');clearTimeout(toastT);toastT=setTimeout(function(){e.classList.remove('on')},2200)}
$('tips').textContent=(navigator.canShare&&ios)?T.tipsIos:'';

/* ---- Kilauan kecil saat halaman dibuka (sekali) ---- */
(function(){if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;var k=$('kilap'),w=['#B08D57','#E7C9A0','#F2B8C6','#FFFFFF','#D9B26F'];
for(var i=0;i<26;i++){var e=document.createElement('i');e.style.left=Math.random()*100+'%';e.style.background=w[i%w.length];
e.style.setProperty('--x',(Math.random()*80-40)+'px');e.style.setProperty('--r',(Math.random()*540-270)+'deg');e.style.animationDelay=(Math.random()*.6)+'s';e.style.animationDuration=(1.8+Math.random()*1.4)+'s';k.appendChild(e)}
setTimeout(function(){k.remove()},4200)})();

/* ---- Foto satuan: tampilkan yang sudah ada, tunggu yang menyusul ---- */
function isiGrid(){var g=$('grid');if(!g)return;
 Array.prototype.forEach.call(g.children,function(sel){var n=+sel.dataset.n;if(ada.indexOf(n)<0||sel.dataset.siap)return;
  sel.dataset.siap='1';sel.className='sel';sel.innerHTML='';
  var b=document.createElement('button');b.className='isi';b.setAttribute('aria-label',T.foto+' '+n);
  var img=new Image();img.alt=T.foto+' '+n;img.decoding='async';img.onload=function(){img.classList.add('ok')};img.src=urlFoto(n);b.appendChild(img);
  b.onclick=function(){buka(daftar().indexOf(n))};
  var no=document.createElement('span');no.className='no';no.textContent=n;
  var u=document.createElement('button');u.className='unduh';u.innerHTML=ikonUnduh;u.setAttribute('aria-label',T.simpanIni+' '+T.foto+' '+n);
  u.onclick=function(e){e.stopPropagation();simpan([n],u)};
  sel.append(b,no,u)});}
isiGrid();
var cekKe=0;(function tanya(){if(ada.length>=D.jumlah||cekKe++>90)return;
 setTimeout(function(){fetch('/s/'+D.kode,{cache:'no-store'}).then(function(r){return r.json()}).then(function(j){if(j&&j.ada){ada=j.ada;isiGrid();if($('lb').classList.contains('on'))bangunLb()}}).catch(function(){}).then(tanya)},4000)})();

/* ---- Simpan: ke galeri lewat menu bagikan (iPhone/Android), atau unduh biasa ---- */
function ambilFile(n){return fetch(urlFoto(n)).then(function(r){if(!r.ok)throw new Error(r.status);return r.blob()}).then(function(b){return new File([b],D.nama[n],{type:'image/jpeg'})})}
function unduhBiasa(n,i){setTimeout(function(){var a=document.createElement('a');a.href='/d/'+D.kode+(n?'/'+n:'');a.download=D.nama[n];document.body.appendChild(a);a.click();a.remove()},i*500)}
var sibuk=false;
function simpan(ns,tombol){if(sibuk)return;sibuk=true;var lama=tombol&&tombol.innerHTML;if(tombol){tombol.disabled=true}
 var selesai=function(ok){sibuk=false;if(tombol){tombol.disabled=false;tombol.innerHTML=lama}if(ok)toast('✓ '+T.tersimpan)};
 if(navigator.canShare&&(ios||/Android/.test(navigator.userAgent))){
  if(tombol&&tombol.querySelector('span'))tombol.querySelector('span').textContent=T.memuat;
  Promise.all(ns.map(ambilFile)).then(function(files){
   if(!navigator.canShare({files:files}))throw new Error('tidak bisa');
   return navigator.share({files:files}).then(function(){selesai(true)},function(e){selesai(false);if(e&&e.name!=='AbortError')toast(T.gagal)})
  }).catch(function(){selesai(false);ns.forEach(unduhBiasa);toast('✓ '+T.tipsLain)});
 } else { ns.forEach(unduhBiasa); selesai(false); toast('✓ '+T.tipsLain) }}
$('semua').onclick=function(){simpan(daftar(),$('semua'))};
if($('satuTpl'))$('satuTpl').onclick=function(){simpan([0],$('satuTpl'))};
$('bagikan').onclick=function(){var u=location.origin+location.pathname+location.search;
 if(navigator.share)navigator.share({url:u,title:D.couple||T.judul}).catch(function(){});
 else if(navigator.clipboard)navigator.clipboard.writeText(u).then(function(){toast('✓ '+T.disalin)});};

/* ---- Lihat besar: geser kiri/kanan, panah, tombol Esc ---- */
var lb=$('lb'),jalur=$('lbJalur'),ke=0,n0=null;
function bangunLb(){var d=daftar();jalur.innerHTML='';$('lbTitik').innerHTML='';
 d.forEach(function(n){var h=document.createElement('div');h.className='lb-hal';var img=new Image();img.src=urlFoto(n);img.alt=n?T.foto+' '+n:T.fotoTemplate;img.draggable=false;h.appendChild(img);jalur.appendChild(h);
  $('lbTitik').appendChild(document.createElement('i'))});ke=Math.min(ke,d.length-1);geser(0,true)}
function geser(dx,cepat){var d=daftar();jalur.style.transition=cepat?'none':'';jalur.style.transform='translateX(calc('+(-ke*100)+'% + '+dx+'px))';
 $('lbNo').textContent=(ke===0?T.fotoTemplate:T.foto+' '+d[ke])+'  ·  '+(ke+1)+' / '+d.length;
 Array.prototype.forEach.call($('lbTitik').children,function(t,i){t.classList.toggle('on',i===ke)});
 $('lbKiri').style.visibility=ke>0?'':'hidden';$('lbKanan').style.visibility=ke<d.length-1?'':'hidden'}
function buka(i){ke=Math.max(0,i);bangunLb();lb.classList.add('on');document.body.style.overflow='hidden';history.pushState({lb:1},'')}
function tutup(dariRiwayat){if(!lb.classList.contains('on'))return;lb.classList.remove('on');document.body.style.overflow='';if(!dariRiwayat)history.back()}
function pindah(a){var d=daftar();ke=Math.max(0,Math.min(d.length-1,ke+a));geser(0)}
$('hero').onclick=function(){buka(0)};$('lbTutup').onclick=function(){tutup()};$('lbKiri').onclick=function(){pindah(-1)};$('lbKanan').onclick=function(){pindah(1)};
$('lbSimpan').onclick=function(){simpan([daftar()[ke]],$('lbSimpan'))};
addEventListener('popstate',function(){tutup(true)});
addEventListener('keydown',function(e){if(!lb.classList.contains('on'))return;if(e.key==='Escape')tutup();if(e.key==='ArrowLeft')pindah(-1);if(e.key==='ArrowRight')pindah(1)});
var rel=$('lbRel'),x0=0,y0=0,tarik=false;
rel.addEventListener('pointerdown',function(e){if(e.target.closest('button'))return;tarik=true;x0=e.clientX;y0=e.clientY;rel.setPointerCapture(e.pointerId)});
rel.addEventListener('pointermove',function(e){if(!tarik)return;geser(e.clientX-x0,true)});
var lepas=function(e){if(!tarik)return;tarik=false;var dx=e.clientX-x0,dy=e.clientY-y0;
 if(Math.abs(dy)>110&&Math.abs(dy)>Math.abs(dx))return tutup();         // geser ke bawah/atas = tutup
 if(dx<-50)pindah(1);else if(dx>50)pindah(-1);else{geser(0);if(Math.abs(dx)<6&&Math.abs(dy)<6&&e.target===rel)tutup()}};
rel.addEventListener('pointerup',lepas);rel.addEventListener('pointercancel',lepas);
})();`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const [, jalur, kode = '', nTeks = ''] = url.pathname.split('/');
    const bahasa = url.searchParams.get('b') === 'en' ? 'en' : 'id';
    const t = TEKS[bahasa];
    const h = hariSimpan(env);
    // Nomor foto satuan: kosong = foto hasil (template), 1-4 = foto satuan
    const n = nTeks === '' ? 0 : /^[1-4]$/.test(nTeks) ? Number(nTeks) : -1;

    if (jalur === 'ping') {
      if (!bolehBooth(req, env)) return json({ ok: false, error: 'Kunci booth salah' }, 401);
      return json({ ok: true, hari: h, satuan: true, video: true });
    }

    /* ---------- Unggah video dari booth (per bagian) ---------- */
    if (jalur === 'uv') {
      if (!bolehBooth(req, env)) return json({ ok: false, error: 'Kunci booth salah' }, 401);
      if (!KODE.test(kode)) return json({ ok: false, error: 'Kode tidak valid' }, 400);
      const kunci = kunciVideo(kode),
        uploadId = url.searchParams.get('u') || '';
      if (nTeks === 'poster' && req.method === 'PUT') {
        const data = await req.arrayBuffer();
        if (!data.byteLength || data.byteLength > MAKS_POSTER)
          return json({ ok: false, error: 'Ukuran gambar tidak valid' }, 413);
        const b = new Uint8Array(data, 0, 3);
        if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff))
          return json({ ok: false, error: 'Bukan gambar JPEG' }, 415);
        await env.FOTO.put(kunciPoster(kode), data, {
          httpMetadata: { contentType: 'image/jpeg' },
          customMetadata: { diunggah: String(Date.now()) },
        });
        return json({ ok: true });
      }
      if (nTeks === 'mulai' && req.method === 'POST') {
        if (await env.FOTO.head(kunci)) return json({ ok: true, ada: true });
        const meta = {
          diunggah: String(Date.now()),
          jenis: req.headers.get('x-leura-jenis') === 'quiz' ? 'quiz' : 'pesan',
        };
        const couple = namaCouple(req.headers.get('x-leura-couple'));
        if (couple) meta.couple = couple;
        const mpu = await env.FOTO.createMultipartUpload(kunci, {
          httpMetadata: { contentType: 'video/mp4' },
          customMetadata: meta,
        });
        return json({ ok: true, uploadId: mpu.uploadId });
      }
      if (/^\d{1,3}$/.test(nTeks) && req.method === 'PUT') {
        const n = Number(nTeks);
        if (n < 1 || n > MAKS_BAGIAN || !uploadId) return json({ ok: false, error: 'Bagian tidak valid' }, 400);
        const data = await req.arrayBuffer();
        if (!data.byteLength || data.byteLength > MAKS_BAGIAN_BYTE)
          return json({ ok: false, error: 'Ukuran bagian tidak valid' }, 413);
        try {
          const bagian = await env.FOTO.resumeMultipartUpload(kunci, uploadId).uploadPart(n, data);
          return json({ ok: true, etag: bagian.etag });
        } catch {
          return json({ ok: false, error: 'upload-hilang' }, 404);
        }
      }
      if (nTeks === 'selesai' && req.method === 'POST') {
        let isi = {};
        try {
          isi = await req.json();
        } catch {
          /* isi bukan JSON: ditangani pemeriksaan "Daftar bagian kosong" di bawah */
        }
        const bagian = Array.isArray(isi.bagian)
          ? isi.bagian
              .filter(x => x && Number.isInteger(x.partNumber) && typeof x.etag === 'string')
              .slice(0, MAKS_BAGIAN)
          : [];
        if (!bagian.length || !uploadId) return json({ ok: false, error: 'Daftar bagian kosong' }, 400);
        try {
          await env.FOTO.resumeMultipartUpload(kunci, uploadId).complete(bagian);
        } catch {
          return json({ ok: false, error: 'upload-hilang' }, 404);
        }
        return json({ ok: true });
      }
      return json({ ok: false, error: 'Metode tidak didukung' }, 405);
    }

    if (jalur === 'u' && req.method === 'PUT') {
      if (!bolehBooth(req, env)) return json({ ok: false, error: 'Kunci booth salah' }, 401);
      if (!KODE.test(kode) || n < 0) return json({ ok: false, error: 'Kode tidak valid' }, 400);
      const data = await req.arrayBuffer();
      if (!data.byteLength || data.byteLength > MAKS_BYTE)
        return json({ ok: false, error: 'Ukuran foto tidak valid' }, 413);
      const b = new Uint8Array(data, 0, 3);
      if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) return json({ ok: false, error: 'Bukan foto JPEG' }, 415);
      const meta = { diunggah: String(Date.now()) };
      if (!n) {
        const couple = namaCouple(req.headers.get('x-leura-couple'));
        const jumlah = Math.min(MAKS_SATUAN, Math.max(0, Number(req.headers.get('x-leura-jumlah')) || 0));
        if (couple) meta.couple = couple;
        if (jumlah) meta.jumlah = String(jumlah);
      }
      await env.FOTO.put(kunciFoto(kode, n), data, {
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: meta,
      });
      return json({ ok: true });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return json({ ok: false, error: 'Metode tidak didukung' }, 405);

    /* ---------- Video untuk tamu ---------- */
    if (jalur === 'vf' || jalur === 'vd') {
      const v = await infoVideo(env, kode);
      if (!v) return new Response('Tidak ditemukan', { status: 404, headers: HEADER_AMAN });
      const headers = {
        'content-type': 'video/mp4',
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=3600',
        ...HEADER_AMAN,
      };
      if (jalur === 'vd')
        headers['content-disposition'] = `attachment; filename="${namaFileVideo(v.couple, kode, v.jenis)}"`;
      const rg = bacaRange(req.headers.get('range'), v.ukuran);
      if (rg && rg.salah)
        return new Response('', { status: 416, headers: { ...headers, 'content-range': `bytes */${v.ukuran}` } });
      if (req.method === 'HEAD')
        return new Response(null, { headers: { ...headers, 'content-length': String(v.ukuran) } });
      if (rg) {
        const obj = await env.FOTO.get(kunciVideo(kode), { range: { offset: rg.offset, length: rg.length } });
        if (!obj) return new Response('Tidak ditemukan', { status: 404, headers: HEADER_AMAN });
        return new Response(obj.body, {
          status: 206,
          headers: {
            ...headers,
            'content-length': String(rg.length),
            'content-range': `bytes ${rg.offset}-${rg.offset + rg.length - 1}/${v.ukuran}`,
          },
        });
      }
      const obj = await env.FOTO.get(kunciVideo(kode));
      if (!obj) return new Response('Tidak ditemukan', { status: 404, headers: HEADER_AMAN });
      return new Response(obj.body, { headers: { ...headers, 'content-length': String(v.ukuran) } });
    }
    if (jalur === 'vp') {
      const obj = KODE.test(kode) ? await env.FOTO.get(kunciPoster(kode)) : null;
      if (!obj || kedaluwarsa(obj, env)) return new Response('Tidak ditemukan', { status: 404, headers: HEADER_AMAN });
      return new Response(obj.body, {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600', ...HEADER_AMAN },
      });
    }
    if (jalur === 'vs') {
      const v = await infoVideo(env, kode);
      return v
        ? json({ ok: true, ada: true, couple: v.couple, jenis: v.jenis, ukuran: v.ukuran, sampai: v.sampai })
        : json({ ok: false, ada: false }, 404);
    }
    if (jalur === 'v') {
      const v = await infoVideo(env, kode);
      if (v) return halamanVideo(t, kode, v, bahasa);
      if (!KODE.test(kode))
        return halaman(t, `<h1>${esc(t.vHilang)}</h1><p class="sub">${esc(t.vHilangInfo.replace('{h}', h))}</p>`);
      // Belum sampai: tanya status setiap 5 detik (video perlu diproses & diunggah, bisa beberapa menit)
      return halaman(
        { ...t, judul: t.vJudul },
        `<div class="putar"></div><h1>${esc(t.vTunggu)}</h1><p class="sub" id="info">${esc(t.vTungguInfo)}</p>`,
        `<script>(function(){var ke=0,info=${JSON.stringify(t.vLama).replace(/</g, '\\u003c')};(function tanya(){if(ke++>1440){document.getElementById('info').textContent=info;return}
setTimeout(function(){fetch('/vs/${kode}',{cache:'no-store'}).then(function(r){if(r.ok)location.reload();else tanya()}).catch(tanya)},5000)})()})()</script>`,
      );
    }

    if (n < 0) return new Response('Tidak ditemukan', { status: 404, headers: HEADER_AMAN });

    if (jalur === 'i' || jalur === 'd') {
      const obj = await ambil(env, kode, n);
      if (!obj) return new Response('Tidak ditemukan', { status: 404, headers: HEADER_AMAN });
      const headers = { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600', ...HEADER_AMAN };
      if (jalur === 'd') {
        const induk = n ? await ambil(env, kode) : obj;
        const couple = induk && induk.customMetadata ? induk.customMetadata.couple : '';
        headers['content-disposition'] = `attachment; filename="${namaFile(couple, kode, n)}"`;
      }
      return new Response(obj.body, { headers });
    }

    if (jalur === 's') {
      const s = KODE.test(kode) ? await statusFoto(env, kode) : null;
      return s ? json({ ok: true, ...s }) : json({ ok: false }, 404);
    }

    if (jalur === 'f') {
      const s = KODE.test(kode) && !n ? await statusFoto(env, kode) : null;
      if (s) return halamanUnduh(t, kode, s, bahasa);
      // Belum sampai (internet booth lambat) atau sudah lewat masa simpan. Muat ulang sendiri selama 15 menit pertama.
      const umur = Number(url.searchParams.get('n') || 0);
      if (KODE.test(kode) && umur < 180) {
        return halaman(
          t,
          `<div class="putar"></div><h1>${esc(t.tunggu)}</h1><p class="sub">${esc(t.tungguInfo)}</p>`,
          `<script>setTimeout(function(){var u=new URL(location.href);u.searchParams.set('n',${umur + 1});location.replace(u)},5000)</script>`,
        );
      }
      return halaman(t, `<h1>${esc(t.hilang)}</h1><p class="sub">${esc(t.hilangInfo.replace('{h}', h))}</p>`);
    }

    return halaman(t, `<h1>Leura Photo Booth</h1>`);
  },
};
