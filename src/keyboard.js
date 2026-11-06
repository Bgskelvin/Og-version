/* =====================================================================
   keyboard.js — keyboard di layar untuk monitor sentuh (tanpa keyboard fisik)
   Pakai:  buatKeyboard($('wadah'), $('input'), { onEnter: () => …, maks: 40 })
   - Huruf besar otomatis di awal setiap kata (nama orang), ⇧ untuk sekali ganti.
   - Tombol 123 untuk angka & tanda baca yang aman untuk nama file.
   - ⌫ ditahan = menghapus terus.
   - Keyboard fisik tetap bisa dipakai (Enter = Lanjut).
   Tulisan tombol mengikuti bahasa layar tamu (t('kb.…') di bahasa.js).
   ===================================================================== */

const KB_HURUF = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'],
  ['123', 'spasi', 'enter'],
];
// Tanpa / \ : * ? " < > | — karakter itu tidak boleh ada di nama file
const KB_ANGKA = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['-', "'", '.', ',', '&', '(', ')', '!', '@'],
  ['#', '+', '=', '_', '~', '%', '⌫'],
  ['ABC', 'spasi', 'enter'],
];

function buatKeyboard(wadah, input, opsi = {}) {
  const maks = opsi.maks || 40;
  let mode = 'huruf', shift = false, shiftManual = false, ulang = null, jeda = null;
  input.setAttribute('inputmode', 'none');      // jangan munculkan keyboard bawaan sistem (Windows/iPad)
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('spellcheck', 'false');
  input.maxLength = maks;

  // Huruf besar otomatis: di awal teks atau setelah spasi
  const awalKata = () => {
    const pos = input.selectionStart ?? input.value.length;
    return pos === 0 || /[\s\-(]$/.test(input.value.slice(0, pos));
  };
  const besar = () => shift || (!shiftManual && awalKata());

  function ketik(teks) {
    if (input.value.length >= maks && input.selectionStart === input.selectionEnd) return;
    const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
    input.setRangeText(teks, a, b, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function hapus() {
    let a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
    if (a === b) { if (a === 0) return; a -= 1; }
    input.setRangeText('', a, b, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function berhentiUlang() { clearTimeout(jeda); clearInterval(ulang); jeda = ulang = null; }

  function tekan(k) {
    if (k === '⌫') { hapus(); return gambar(); }
    if (k === '⇧') { shift = !besar(); shiftManual = !shift; return gambar(); }
    if (k === '123') { mode = 'angka'; return gambar(); }
    if (k === 'ABC') { mode = 'huruf'; return gambar(); }
    if (k === 'enter') { if (opsi.onEnter) opsi.onEnter(); return; }
    if (k === 'spasi') { if (input.value && !/\s$/.test(input.value.slice(0, input.selectionStart))) ketik(' '); }
    else ketik(mode === 'huruf' && besar() ? k.toUpperCase() : k);
    shift = false; shiftManual = false;
    gambar();
  }

  function gambar() {
    const baris = mode === 'huruf' ? KB_HURUF : KB_ANGKA;
    const up = mode === 'huruf' && besar();
    wadah.innerHTML = '';
    wadah.classList.add('kb');
    for (const row of baris) {
      const r = document.createElement('div'); r.className = 'kb-baris';
      for (const k of row) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'kb-tombol';
        b.dataset.k = k;
        if (k === 'spasi') { b.classList.add('kb-spasi'); b.textContent = t('kb.spasi'); }
        else if (k === 'enter') { b.classList.add('kb-enter'); b.textContent = t('kb.lanjut'); b.disabled = !input.value.trim(); }
        else if (k === '⌫') { b.classList.add('kb-fungsi'); b.textContent = '⌫'; b.setAttribute('aria-label', t('kb.hapus')); }
        else if (k === '⇧') { b.classList.add('kb-fungsi'); b.classList.toggle('aktif', up); b.textContent = '⇧'; b.setAttribute('aria-label', 'Shift'); }
        else if (k === '123' || k === 'ABC') { b.classList.add('kb-fungsi'); b.textContent = k; }
        else b.textContent = up ? k.toUpperCase() : k;
        r.appendChild(b);
      }
      wadah.appendChild(r);
    }
  }

  // pointerdown: langsung bereaksi di layar sentuh, dan kursor tidak lepas dari kolom nama
  wadah.addEventListener('pointerdown', e => {
    const b = e.target.closest('.kb-tombol');
    if (!b || b.disabled) return;
    e.preventDefault();
    input.focus({ preventScroll: true });
    b.classList.add('ditekan');
    const k = b.dataset.k;
    tekan(k);
    if (k === '⌫') { jeda = setTimeout(() => { ulang = setInterval(hapus, 70); }, 450); }
  });
  const lepas = () => { const tadi = !!ulang; berhentiUlang(); wadah.querySelectorAll('.ditekan').forEach(x => x.classList.remove('ditekan')); if (tadi) gambar(); };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => wadah.addEventListener(ev, lepas));
  // Ketikan dari keyboard fisik: perbarui huruf besar & tombol Lanjut
  input.addEventListener('input', () => { if (!wadah.querySelector('.ditekan')) gambar(); else { const en = wadah.querySelector('.kb-enter'); if (en) en.disabled = !input.value.trim(); } });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (opsi.onEnter) opsi.onEnter(); } });

  gambar();
  return {
    gambarUlang: gambar,                     // mis. setelah bahasa layar tamu diganti
    reset: () => { mode = 'huruf'; shift = false; shiftManual = false; berhentiUlang(); gambar(); },
  };
}
