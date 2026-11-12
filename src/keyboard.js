/* =====================================================================
   keyboard.js — on-screen keyboard for touch monitors (no physical keyboard)
   Use:  createKeyboard($('container'), $('input'), { onEnter: () => …, maxLength: 40 })
   - Automatic capital at the start of every word (people's names), ⇧ for one change.
   - The 123 key for numbers & punctuation that is safe in file names.
   - Holding ⌫ keeps deleting.
   - A physical keyboard still works (Enter = Continue).
   Key labels follow the guest screen language (t('kb.…') in language.js).
   Key values ('spasi', 'enter', …) are data-k attributes used by CSS and tests.
   ===================================================================== */
import { t } from './language.js';

const LETTER_KEYS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'],
  ['123', 'spasi', 'enter'],
];
// No / \ : * ? " < > | — those characters are not allowed in file names
const NUMBER_KEYS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['-', "'", '.', ',', '&', '(', ')', '!', '@'],
  ['#', '+', '=', '_', '~', '%', '⌫'],
  ['ABC', 'spasi', 'enter'],
];

export function createKeyboard(container, input, options = {}) {
  const maxLength = options.maxLength || 40;
  let mode = 'letters',
    shift = false,
    shiftManual = false,
    repeatTimer = null,
    repeatDelay = null;
  input.setAttribute('inputmode', 'none'); // don't show the system keyboard (Windows/iPad)
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('spellcheck', 'false');
  input.maxLength = maxLength;

  // Automatic capitals: at the start of the text or after a space
  const atWordStart = () => {
    const pos = input.selectionStart ?? input.value.length;
    return pos === 0 || /[\s\-(]$/.test(input.value.slice(0, pos));
  };
  const upper = () => shift || (!shiftManual && atWordStart());

  function typeText(text) {
    if (input.value.length >= maxLength && input.selectionStart === input.selectionEnd) return;
    const a = input.selectionStart ?? input.value.length,
      b = input.selectionEnd ?? a;
    input.setRangeText(text, a, b, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function deleteChar() {
    let a = input.selectionStart ?? input.value.length;
    const b = input.selectionEnd ?? a;
    if (a === b) {
      if (a === 0) return;
      a -= 1;
    }
    input.setRangeText('', a, b, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function stopRepeat() {
    clearTimeout(repeatDelay);
    clearInterval(repeatTimer);
    repeatDelay = repeatTimer = null;
  }

  function press(k) {
    if (k === '⌫') {
      deleteChar();
      return render();
    }
    if (k === '⇧') {
      shift = !upper();
      shiftManual = !shift;
      return render();
    }
    if (k === '123') {
      mode = 'numbers';
      return render();
    }
    if (k === 'ABC') {
      mode = 'letters';
      return render();
    }
    if (k === 'enter') {
      if (options.onEnter) options.onEnter();
      return;
    }
    if (k === 'spasi') {
      if (input.value && !/\s$/.test(input.value.slice(0, input.selectionStart))) typeText(' ');
    } else typeText(mode === 'letters' && upper() ? k.toUpperCase() : k);
    shift = false;
    shiftManual = false;
    render();
  }

  function render() {
    const rows = mode === 'letters' ? LETTER_KEYS : NUMBER_KEYS;
    const up = mode === 'letters' && upper();
    container.innerHTML = '';
    container.classList.add('kb');
    for (const row of rows) {
      const r = document.createElement('div');
      r.className = 'kb-row';
      for (const k of row) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'kb-key';
        b.dataset.k = k;
        if (k === 'spasi') {
          b.classList.add('kb-space');
          b.textContent = t('kb.space');
        } else if (k === 'enter') {
          b.classList.add('kb-enter');
          b.textContent = t('kb.continue');
          b.disabled = !input.value.trim();
        } else if (k === '⌫') {
          b.classList.add('kb-func');
          b.textContent = '⌫';
          b.setAttribute('aria-label', t('kb.delete'));
        } else if (k === '⇧') {
          b.classList.add('kb-func');
          b.classList.toggle('active', up);
          b.textContent = '⇧';
          b.setAttribute('aria-label', 'Shift');
        } else if (k === '123' || k === 'ABC') {
          b.classList.add('kb-func');
          b.textContent = k;
        } else b.textContent = up ? k.toUpperCase() : k;
        r.appendChild(b);
      }
      container.appendChild(r);
    }
  }

  // pointerdown: reacts immediately on touch screens, and the cursor stays in the name field
  container.addEventListener('pointerdown', e => {
    const b = e.target.closest('.kb-key');
    if (!b || b.disabled) return;
    e.preventDefault();
    input.focus({ preventScroll: true });
    b.classList.add('pressed');
    const k = b.dataset.k;
    press(k);
    if (k === '⌫') {
      repeatDelay = setTimeout(() => {
        repeatTimer = setInterval(deleteChar, 70);
      }, 450);
    }
  });
  const release = () => {
    const wasRepeating = !!repeatTimer;
    stopRepeat();
    container.querySelectorAll('.pressed').forEach(x => x.classList.remove('pressed'));
    if (wasRepeating) render();
  };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => container.addEventListener(ev, release));
  // Typing on a physical keyboard: update capitals & the Continue button
  input.addEventListener('input', () => {
    if (!container.querySelector('.pressed')) render();
    else {
      const en = container.querySelector('.kb-enter');
      if (en) en.disabled = !input.value.trim();
    }
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (options.onEnter) options.onEnter();
    }
  });

  render();
  return {
    redraw: render, // e.g. after the guest screen language changes
    reset: () => {
      mode = 'letters';
      shift = false;
      shiftManual = false;
      stopRepeat();
      render();
    },
  };
}
