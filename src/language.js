/* =====================================================================
   language.js — guest screen language (set in Admin → Display).
   Admin pages are always English (the guest screens default to English too).
   Text typed by Admin (welcome, quiz questions, template text) shows as is.

   How to use:
   - Fixed text in index.html: add data-t="key". The Indonesian text stays in
     the HTML; its translation goes in DICTIONARY.en['@key'].
   - Text from JavaScript: t('key', { n: 3 }) → reads DICTIONARY[language].
   Adding a language: add DICTIONARY.xx, LOCALES.xx, and its choice in Admin.
   Dictionary keys ('name.hi', 'kb.space', …) are used by data-t attributes.
   ===================================================================== */

export let language = 'en';
const LOCALES = { id: 'id-ID', en: 'en-GB' }; // date format

const DICTIONARY = {
  id: {
    'quiz.empty': 'Belum ada pertanyaan untuk couple ini. Tambahkan lewat halaman Admin.',
    'quiz.info': '{n} pertanyaan acak · {s} detik per pertanyaan',
    'quiz.next': 'Lanjut',
    'quiz.done': 'Selesai',
    'quiz.timeLeft': 'Sisa waktu {t}',
    'quiz.round': 'Pertanyaan {i} dari {n}',
    'pb.intro': '{n} foto · hitung mundur {s} detik sebelum setiap foto',
    'pb.photoOf': 'Foto {i} dari {n}',
    'pb.retakeNth': 'Ulangi foto {i}',
    'pb.label': 'Foto {i}',
    'pb.retake': 'Ulangi',
    'pb.back': 'Kembali',
    'pb.cancel': 'Batal',
    'pb.confirmCancel': 'Yakin batal?',
    'pb.pickSticker': 'Ketuk stiker di foto dulu untuk memilihnya.',
    'saving.photo': 'Menyimpan fotomu',
    'saving.recording': 'Menyimpan rekamanmu',
    'thanks.photoOk': 'Fotomu sudah tersimpan.',
    'thanks.photoFailed': 'Fotomu belum berhasil tersimpan. Silakan hubungi petugas.',
    'thanks.ok': 'Rekamanmu sudah tersimpan.',
    'thanks.slow': 'Rekamanmu sedang diselesaikan dan akan tersimpan otomatis.',
    'thanks.failed': 'Rekamanmu belum berhasil tersimpan. Silakan hubungi petugas.',
    'thanks.qrPhoto': 'Pindai untuk mengunduh fotomu',
    'thanks.qrPhotoInfo': 'Foto tersedia selama 7 hari.',
    'thanks.qrVideo': 'Pindai untuk mengunduh videomu',
    'thanks.qrVideoInfo': 'Siap dalam beberapa menit · tersedia 7 hari.',
    'layout.grid': 'Kisi 2×2',
    'layout.strip': 'Strip',
    'layout.big': '1 besar + 3',
    'filter.none': 'Normal',
    'filter.bw': 'Hitam putih',
    'filter.warm': 'Hangat',
    'filter.soft': 'Lembut',
    'filter.vintage': 'Vintage',
    'filter.bright': 'Cerah',
    'name.hi': 'Hai, {name}!',
    'kb.space': 'spasi',
    'kb.continue': 'Lanjut',
    'kb.delete': 'Hapus',
    'frame.0': 'Putih',
    'frame.1': 'Krem',
    'frame.2': 'Blush',
    'frame.3': 'Sage',
    'frame.4': 'Hitam',
    'frame.5': 'Aksen',
  },
  en: {
    // fixed text in index.html (data-t)
    '@start.touch': 'Touch to start',
    '@name.title': "What's your name?",
    '@name.info': 'Your name will be saved with your video and photos for the couple.',
    '@home.message': 'Leave a message',
    '@home.quiz': 'Quick quiz',
    '@home.photo': 'Photo booth',
    '@home.messageInfo': 'Record a message for the couple',
    '@home.quizInfo': 'Answer a few fun questions',
    '@home.photoInfo': 'Take 4 photos, then decorate them',
    '@back': 'Back',
    '@start': 'Start',
    '@done': 'Done',
    '@delete': 'Delete',
    '@message.title': 'Leave a message',
    '@message.hint': 'Press Start, share your message, then press Done.',
    '@quiz.start': 'Start quiz',
    '@saving.wait': 'Please wait a moment',
    '@thanks.title': 'Thank you',
    '@thanks.menu': 'Back to menu',
    '@pb.finishEdit': 'Finish & edit',
    '@thanks.qr': 'Scan to download your photo',
    '@thanks.qrInfo': 'Available for 7 days.',
    '@pe.photos': 'Photos',
    '@pe.title': 'Edit photo',
    '@pe.tab.frame': 'Frame',
    '@pe.tab.stickers': 'Stickers',
    '@pe.tab.draw': 'Draw',
    '@pe.layout': 'Photo layout',
    '@pe.filter': 'Filter for all photos',
    '@pe.frameColor': 'Frame color',
    '@pe.nameDate': 'Couple name & date',
    '@pe.hintTemplate': 'This design already has its own frame and text.',
    '@pe.tapToAdd': 'Tap to add',
    '@pe.selectedSticker': 'Selected sticker',
    '@pe.smaller': 'Smaller',
    '@pe.bigger': 'Bigger',
    '@pe.rotate': 'Rotate',
    '@pe.hintSticker': 'Drag a sticker with your finger. Use two fingers to resize and rotate it.',
    '@pe.color': 'Colour',
    '@pe.size': 'Size',
    '@pe.undo': 'Undo',
    '@pe.clearAll': 'Clear all',
    '@pe.hintDraw': 'Write a greeting or sign directly on the photo with your finger.',
    // text from JavaScript
    'quiz.empty': 'There are no questions yet.',
    'quiz.info': '{n} random questions · {s} seconds each',
    'quiz.next': 'Next',
    'quiz.done': 'Done',
    'quiz.timeLeft': 'Time left {t}',
    'quiz.round': 'Question {i} of {n}',
    'pb.intro': '{n} photos · {s}-second countdown before each',
    'pb.photoOf': 'Photo {i} of {n}',
    'pb.retakeNth': 'Retake photo {i}',
    'pb.label': 'Photo {i}',
    'pb.retake': 'Retake',
    'pb.back': 'Back',
    'pb.cancel': 'Cancel',
    'pb.confirmCancel': 'Cancel for sure?',
    'pb.pickSticker': 'Tap a sticker on the photo first to select it.',
    'saving.photo': 'Saving your photos',
    'saving.recording': 'Saving your recording',
    'thanks.photoOk': 'Your photos have been saved.',
    'thanks.photoFailed': 'Your photos could not be saved. Please ask our staff for help.',
    'thanks.ok': 'Your recording has been saved.',
    'thanks.slow': 'Your recording is being finished and will be saved automatically.',
    'thanks.failed': 'Your recording could not be saved. Please ask our staff for help.',
    'thanks.qrPhoto': 'Scan to download your photo',
    'thanks.qrPhotoInfo': 'Available for 7 days.',
    'thanks.qrVideo': 'Scan to download your video',
    'thanks.qrVideoInfo': 'Ready in a few minutes · available for 7 days.',
    'layout.grid': 'Grid 2×2',
    'layout.strip': 'Strip',
    'layout.big': '1 large + 3',
    'filter.none': 'Normal',
    'filter.bw': 'Black & white',
    'filter.warm': 'Warm',
    'filter.soft': 'Soft',
    'filter.vintage': 'Vintage',
    'filter.bright': 'Bright',
    'name.hi': 'Hi, {name}!',
    'kb.space': 'space',
    'kb.continue': 'Continue',
    'kb.delete': 'Delete',
    'frame.0': 'White',
    'frame.1': 'Cream',
    'frame.2': 'Blush',
    'frame.3': 'Sage',
    'frame.4': 'Black',
    'frame.5': 'Accent',
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
