/* =====================================================================
   language.js — guest screen language (set in Admin → Display).
   Admin pages are always English (the guest screens default to English too).
   Text typed by Admin (welcome, quiz questions, template text) shows as is.

   How to use:
   - Fixed text in index.html: add data-t="key". The Indonesian text stays in
     the HTML; its translation goes in DICTIONARY.en['@key'].
   - Text from JavaScript: t('key', { n: 3 }) → reads DICTIONARY[language].
   Adding a language: add DICTIONARY.xx, LOCALES.xx, and its choice in Admin.
   Dictionary keys ('nama.hai', 'kb.spasi', …) are used by data-t attributes.
   ===================================================================== */

export let language = 'en';
const LOCALES = { id: 'id-ID', en: 'en-GB' }; // date format

const DICTIONARY = {
  id: {
    'quiz.kosong': 'Belum ada pertanyaan untuk couple ini. Tambahkan lewat halaman Admin.',
    'quiz.info': '{n} pertanyaan acak · {s} detik per pertanyaan',
    'quiz.lanjut': 'Lanjut',
    'quiz.selesai': 'Selesai',
    'quiz.sisa': 'Sisa waktu {t}',
    'quiz.ronde': 'Pertanyaan {i} dari {n}',
    'pb.intro': '{n} foto · hitung mundur {s} detik sebelum setiap foto',
    'pb.ke': 'Foto {i} dari {n}',
    'pb.ulangiKe': 'Ulangi foto {i}',
    'pb.label': 'Foto {i}',
    'pb.ulangi': 'Ulangi',
    'pb.kembali': 'Kembali',
    'pb.batal': 'Batal',
    'pb.yakin': 'Yakin batal?',
    'pb.pilihStiker': 'Ketuk stiker di foto dulu untuk memilihnya.',
    'simpan.foto': 'Menyimpan fotomu',
    'simpan.rekaman': 'Menyimpan rekamanmu',
    'tk.fotoOk': 'Fotomu sudah tersimpan.',
    'tk.fotoGagal': 'Fotomu belum berhasil tersimpan. Silakan hubungi petugas.',
    'tk.ok': 'Rekamanmu sudah tersimpan.',
    'tk.lambat': 'Rekamanmu sedang diselesaikan dan akan tersimpan otomatis.',
    'tk.gagal': 'Rekamanmu belum berhasil tersimpan. Silakan hubungi petugas.',
    'tk.qrFoto': 'Pindai untuk mengunduh fotomu',
    'tk.qrFotoInfo': 'Foto tersedia selama 7 hari.',
    'tk.qrVideo': 'Pindai untuk mengunduh videomu',
    'tk.qrVideoInfo': 'Siap dalam beberapa menit · tersedia 7 hari.',
    'layout.grid': 'Kisi 2×2',
    'layout.strip': 'Strip',
    'layout.big': '1 besar + 3',
    'filter.none': 'Normal',
    'filter.bw': 'Hitam putih',
    'filter.warm': 'Hangat',
    'filter.soft': 'Lembut',
    'filter.vintage': 'Vintage',
    'filter.bright': 'Cerah',
    'nama.hai': 'Hai, {name}!',
    'kb.spasi': 'spasi',
    'kb.lanjut': 'Lanjut',
    'kb.hapus': 'Hapus',
    'bingkai.0': 'Putih',
    'bingkai.1': 'Krem',
    'bingkai.2': 'Blush',
    'bingkai.3': 'Sage',
    'bingkai.4': 'Hitam',
    'bingkai.5': 'Aksen',
  },
  en: {
    // fixed text in index.html (data-t)
    '@start.sentuh': 'Touch to start',
    '@nama.judul': "What's your name?",
    '@nama.info': 'Your name will be saved with your video and photos for the couple.',
    '@utama.pesan': 'Leave a message',
    '@utama.quiz': 'Quick quiz',
    '@utama.foto': 'Photo booth',
    '@utama.pesanInfo': 'Record a message for the couple',
    '@utama.quizInfo': 'Answer a few fun questions',
    '@utama.fotoInfo': 'Take 4 photos, then decorate them',
    '@kembali': 'Back',
    '@mulai': 'Start',
    '@selesai': 'Done',
    '@hapus': 'Delete',
    '@pesan.judul': 'Leave a message',
    '@pesan.petunjuk': 'Press Start, share your message, then press Done.',
    '@quiz.mulai': 'Start quiz',
    '@simpan.tunggu': 'Please wait a moment',
    '@tk.judul': 'Thank you',
    '@tk.menu': 'Back to menu',
    '@pb.selesaiEdit': 'Finish & edit',
    '@tk.qr': 'Scan to download your photo',
    '@tk.qrInfo': 'Available for 7 days.',
    '@pe.foto': 'Photos',
    '@pe.judul': 'Edit photo',
    '@pe.tab.bingkai': 'Frame',
    '@pe.tab.stiker': 'Stickers',
    '@pe.tab.coret': 'Draw',
    '@pe.susunan': 'Photo layout',
    '@pe.filter': 'Filter for all photos',
    '@pe.warnaBingkai': 'Frame color',
    '@pe.namaTanggal': 'Couple name & date',
    '@pe.hintTemplate': 'This design already has its own frame and text.',
    '@pe.ketuk': 'Tap to add',
    '@pe.stikerPilih': 'Selected sticker',
    '@pe.perkecil': 'Smaller',
    '@pe.perbesar': 'Bigger',
    '@pe.putar': 'Rotate',
    '@pe.hintStiker': 'Drag a sticker with your finger. Use two fingers to resize and rotate it.',
    '@pe.warna': 'Colour',
    '@pe.ukuran': 'Size',
    '@pe.urungkan': 'Undo',
    '@pe.hapusSemua': 'Clear all',
    '@pe.hintCoret': 'Write a greeting or sign directly on the photo with your finger.',
    // text from JavaScript
    'quiz.kosong': 'There are no questions yet.',
    'quiz.info': '{n} random questions · {s} seconds each',
    'quiz.lanjut': 'Next',
    'quiz.selesai': 'Done',
    'quiz.sisa': 'Time left {t}',
    'quiz.ronde': 'Question {i} of {n}',
    'pb.intro': '{n} photos · {s}-second countdown before each',
    'pb.ke': 'Photo {i} of {n}',
    'pb.ulangiKe': 'Retake photo {i}',
    'pb.label': 'Photo {i}',
    'pb.ulangi': 'Retake',
    'pb.kembali': 'Back',
    'pb.batal': 'Cancel',
    'pb.yakin': 'Cancel for sure?',
    'pb.pilihStiker': 'Tap a sticker on the photo first to select it.',
    'simpan.foto': 'Saving your photos',
    'simpan.rekaman': 'Saving your recording',
    'tk.fotoOk': 'Your photos have been saved.',
    'tk.fotoGagal': 'Your photos could not be saved. Please ask our staff for help.',
    'tk.ok': 'Your recording has been saved.',
    'tk.lambat': 'Your recording is being finished and will be saved automatically.',
    'tk.gagal': 'Your recording could not be saved. Please ask our staff for help.',
    'tk.qrFoto': 'Scan to download your photo',
    'tk.qrFotoInfo': 'Available for 7 days.',
    'tk.qrVideo': 'Scan to download your video',
    'tk.qrVideoInfo': 'Ready in a few minutes · available for 7 days.',
    'layout.grid': 'Grid 2×2',
    'layout.strip': 'Strip',
    'layout.big': '1 large + 3',
    'filter.none': 'Normal',
    'filter.bw': 'Black & white',
    'filter.warm': 'Warm',
    'filter.soft': 'Soft',
    'filter.vintage': 'Vintage',
    'filter.bright': 'Bright',
    'nama.hai': 'Hi, {name}!',
    'kb.spasi': 'space',
    'kb.lanjut': 'Continue',
    'kb.hapus': 'Delete',
    'bingkai.0': 'White',
    'bingkai.1': 'Cream',
    'bingkai.2': 'Blush',
    'bingkai.3': 'Sage',
    'bingkai.4': 'Black',
    'bingkai.5': 'Accent',
  },
};

// Get a text in the guest screen language. {n} etc. are replaced with the values in `values`.
export function t(key, values = {}) {
  const s = (DICTIONARY[language] && DICTIONARY[language][key]) ?? DICTIONARY.id[key] ?? key;
  return String(s).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
}
export const todayDate = () =>
  new Date().toLocaleDateString(LOCALES[language] || 'id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

// Replace every text marked data-t. Only the text changes; icons inside buttons stay.
function applyLanguage() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-t]').forEach(el => {
    const node = [...el.childNodes].reverse().find(n => n.nodeType === 3 && n.nodeValue.trim());
    if (!node) return;
    if (el._original == null) el._original = node.nodeValue;
    const translation = DICTIONARY[language] && DICTIONARY[language]['@' + el.dataset.t];
    node.nodeValue = language !== 'id' && translation ? translation : el._original;
  });
}
// Code that shows translated text it built itself (e.g. the on-screen keyboard) redraws on change
const languageListeners = [];
export const onLanguageChange = fn => languageListeners.push(fn);
export function setLanguage(lang) {
  language = DICTIONARY[lang] ? lang : 'en';
  applyLanguage();
  languageListeners.forEach(fn => fn());
}
