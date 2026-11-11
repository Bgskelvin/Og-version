/* =====================================================================
   template-editor.js — template list & photo design template editor
   (Admin → Photo booth settings). Templates are saved per couple.
   Drawing uses template-render.js, the same as the guests' result.
   Template data fields (nama, ukuran, rasio, latarWarna, …) and the image
   keys 'latar' / 'bingkai' (also te.latar / te.bingkai, read as te[kind])
   are shared with the main process and renamed with it in refactor/main-english.
   Tab and kind values ('desain', 'slot', 'teks', …) match data-* attributes in index.html.
   ===================================================================== */
import {
  setTemplateCoupleName,
  TEMPLATE_FONTS,
  FONT_NAMES,
  loadImage,
  prepareTemplate,
  drawTemplate,
  textWidth,
  PHOTO_RATIOS,
  ratioValue,
  fitRatio,
  applyRatio,
  photoArrangement,
  defaultTexts,
} from './template-render.js';
import { applyLut, sampleFilterPhoto, loadLut, forgetLut } from './lut.js';
import { $, state } from './state.js';
import { flash, resetIdle, show } from './app.js';

const TEMPLATE_SIZES = {
  '4r-tegak': { W: 1200, H: 1800, nama: '4R portrait (4×6)' },
  '4r-datar': { W: 1800, H: 1200, nama: '4R landscape (6×4)' },
  strip: { W: 600, H: 1800, nama: 'Strip 2×6' },
  persegi: { W: 1200, H: 1200, nama: 'Square' },
};
const ARRANGEMENTS = [
  ['kisi', 'Grid 2×2'],
  ['kolom', 'Column'],
  ['baris', 'Row'],
  ['besar', '1 big + 3'],
];
const BACKGROUND_COLORS = ['#FFFFFF', '#F3EDE4', '#F6E1E3', '#E3EBE1', '#E6ECF5', '#1D1D1F'];
const TEXT_COLORS = ['#1D1D1F', '#FFFFFF', '#6E6E73', '#8C6A4F', '#5B3A40', '#2F4030'];

// Editor state (also exposed to the UI tests through debug-handle.js)
export const te = {
  tpl: null,
  images: {},
  latar: null,
  bingkai: null,
  sel: { kind: 'slot', i: 0 },
  dirty: false,
  cancelArmed: null,
  tab: 'desain',
  samplePhoto: null,
  filterList: [],
};
let deleteFilterArmed = null;
let deleteTemplateArmed = null;
let templateCouple = null; // couple whose templates are being managed (not always the active couple)
export const getTemplateCouple = () => templateCouple;
export const clearTemplateCouple = () => {
  templateCouple = null;
};

/* ---------------- Template list on the couple page ---------------- */
export async function listCoupleTemplates(couple = templateCouple) {
  templateCouple = couple;
  if (state.current === 'tambah' || state.current === 'tpleditor') setTemplateCoupleName(couple ? couple.name : null);
  const box = $('tplList');
  box.innerHTML = '';
  const list = couple ? await api.listTemplates(couple.id) : [];
  if (couple !== templateCouple) return; // already moved to another couple
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'item muted';
    empty.textContent = 'No templates yet. Guests use the built-in layouts (Grid 2×2, Strip, 1 big + 3).';
    box.appendChild(empty);
    return;
  }
  for (const t of list) {
    const row = document.createElement('div');
    row.className = 'item split tpl-row';
    const mini = document.createElement('canvas');
    mini.className = 'tpl-mini';
    const k = 64 / Math.max(t.W, t.H);
    mini.width = Math.round(t.W * k);
    mini.height = Math.round(t.H * k);
    prepareTemplate(t).then(prepared => drawTemplate(mini.getContext('2d'), prepared, { scale: k, placeholder: true }));
    const info = document.createElement('div');
    info.className = 'tpl-info';
    info.innerHTML = `<b></b><span class="muted"></span>`;
    info.querySelector('b').textContent = t.nama;
    info.querySelector('span').textContent =
      ((TEMPLATE_SIZES[t.ukuran] || {}).nama || t.ukuran) + (t.filter ? ' · with filter' : '');
    const edit = document.createElement('button');
    edit.className = 'btn sm tint';
    edit.textContent = 'Edit';
    edit.onclick = () => openTemplateEditor(t);
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn sm tint danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = async () => {
      if (deleteTemplateArmed !== t.id) {
        // press twice to confirm
        deleteTemplateArmed = t.id;
        deleteBtn.textContent = 'Delete for sure?';
        setTimeout(() => {
          if (deleteTemplateArmed === t.id) {
            deleteTemplateArmed = null;
            deleteBtn.textContent = 'Delete';
          }
        }, 3000);
        return;
      }
      deleteTemplateArmed = null;
      const r = await api.deleteTemplate(t.id);
      if (r.error) flash('tplMsg', r.error, true);
      else flash('tplMsg', `Template "${t.nama}" deleted.`);
      listCoupleTemplates();
    };
    row.append(mini, info, edit, deleteBtn);
    box.appendChild(row);
  }
}

/* ---------------- Opening the editor ---------------- */
function newTemplate() {
  const { W, H } = TEMPLATE_SIZES['4r-tegak'];
  return {
    id: 'tpl' + Date.now(),
    coupleId: templateCouple.id,
    nama: '',
    ukuran: '4r-tegak',
    W,
    H,
    latarWarna: '#FFFFFF',
    rasio: '3:2',
    filter: null,
    filterKekuatan: 100,
    filterTamu: true,
    slots: photoArrangement('kisi', W, H, 3 / 2),
    texts: defaultTexts(W, H),
  };
}
export async function openTemplateEditor(tpl) {
  if (!templateCouple) return flash('tplMsg', 'Save this couple first.', true);
  te.tpl = tpl ? JSON.parse(JSON.stringify({ ...tpl, latarUrl: undefined, bingkaiUrl: undefined })) : newTemplate();
  te.images = {};
  te.latar = tpl ? await loadImage(tpl.latarUrl) : null;
  te.bingkai = tpl ? await loadImage(tpl.bingkaiUrl) : null;
  te.sel = { kind: 'slot', i: 0 };
  te.dirty = false;
  te.samplePhoto = null;
  disarmCancel();
  if (te.tpl.filterKekuatan == null) te.tpl.filterKekuatan = 100;
  if (te.tpl.filterTamu == null) te.tpl.filterTamu = true;
  $('teTitle').textContent = (tpl ? 'Edit template' : 'New template') + ' · ' + templateCouple.name;
  $('teNama').value = te.tpl.nama;
  $('teLatarStatus').textContent = te.latar ? 'Image added' : 'None';
  $('teBingkaiStatus').textContent = te.bingkai ? 'Frame added' : 'None';
  show('tpleditor');
  setEditorTab('desain');
  fillEditorPanel();
  fillFilterPanel();
  requestAnimationFrame(fitEditorCanvas);
}

/* ---------------- Drawing & handles ---------------- */
const editorScale = () => $('teBox').getBoundingClientRect().width / te.tpl.W;
function fitEditorCanvas() {
  if (!te.tpl) return;
  const st = $('teStage').getBoundingClientRect();
  const k = Math.min((st.width - 48) / te.tpl.W, (st.height - 48) / te.tpl.H);
  $('teBox').style.width = Math.floor(te.tpl.W * k) + 'px';
  $('teBox').style.height = Math.floor(te.tpl.H * k) + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  $('teCanvas').width = Math.round(te.tpl.W * k * dpr);
  $('teCanvas').height = Math.round(te.tpl.H * k * dpr);
  drawEditor();
}
function drawEditor() {
  const c = $('teCanvas'),
    ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  // In the Filter tab, photo boxes show the filtered sample photo so the result is visible
  const photos = te.tab === 'filter' ? Array(4).fill(te.samplePhoto || sampleFilterPhoto()) : [];
  drawTemplate(
    ctx,
    { tpl: te.tpl, background: te.latar, frame: te.bingkai },
    { scale: c.width / te.tpl.W, placeholder: true, photos },
  );
  placeHandles();
}
/* Handles on top of the drawing. Existing handles are only moved (not
   recreated) so a finger that is dragging doesn't "lose" its grip. */
function placeHandles() {
  const box = $('teHandles'),
    { W, H } = te.tpl,
    pct = (v, t) => (v / t) * 100 + '%';
  const slots = box.querySelectorAll('.te-slot'),
    texts = box.querySelectorAll('.te-text');
  if (slots.length !== te.tpl.slots.length || texts.length !== te.tpl.texts.length) {
    box.innerHTML = '';
    te.tpl.slots.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'te-slot';
      el.innerHTML = `<span class="te-no">${i + 1}</span><span class="te-resize" title="Resize"></span>`;
      attachDrag(el, 'slot', i);
      attachDrag(el.querySelector('.te-resize'), 'resize', i);
      box.appendChild(el);
    });
    te.tpl.texts.forEach((t, i) => {
      const el = document.createElement('div');
      el.className = 'te-text';
      attachDrag(el, 'teks', i);
      box.appendChild(el);
    });
    return placeHandles();
  }
  te.tpl.slots.forEach((s, i) => {
    const el = slots[i];
    el.classList.toggle('sel', te.sel.kind === 'slot' && te.sel.i === i);
    Object.assign(el.style, { left: pct(s.x, W), top: pct(s.y, H), width: pct(s.w, W), height: pct(s.h, H) });
  });
  te.tpl.texts.forEach((t, i) => {
    const el = texts[i],
      w = textWidth(t) + t.size * 0.4,
      h = t.size * 1.3;
    el.classList.toggle('sel', te.sel.kind === 'teks' && te.sel.i === i);
    Object.assign(el.style, {
      left: pct(t.x - w / 2, W),
      top: pct(t.y - h / 2, H),
      width: pct(w, W),
      height: pct(h, H),
    });
  });
}

// Snap to the center & edges when close
function snap(value, candidates, distance) {
  for (const k of candidates) if (Math.abs(value - k) <= distance) return k;
  return value;
}
function attachDrag(el, kind, i) {
  let start = null;
  el.addEventListener('pointerdown', e => {
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const obj = kind === 'teks' ? te.tpl.texts[i] : te.tpl.slots[i];
    start = { x: e.clientX, y: e.clientY, obj: { ...obj } };
    te.sel = { kind: kind === 'teks' ? 'teks' : 'slot', i };
    fillEditorPanel();
    placeHandles();
    resetIdle();
    if (kind !== 'teks') setEditorTab('foto');
    else setEditorTab('teks');
  });
  el.addEventListener('pointermove', e => {
    if (!start) return;
    const k = editorScale(),
      dx = (e.clientX - start.x) / k,
      dy = (e.clientY - start.y) / k;
    const { W, H } = te.tpl,
      distance = 12 / k;
    if (kind === 'slot') {
      const s = te.tpl.slots[i],
        o = start.obj;
      s.x = Math.round(snap(o.x + dx, [0, W / 2 - o.w / 2, W - o.w], distance));
      s.y = Math.round(snap(o.y + dy, [0, H / 2 - o.h / 2, H - o.h], distance));
    } else if (kind === 'resize') {
      const s = te.tpl.slots[i],
        o = start.obj,
        r = ratioValue(te.tpl.rasio);
      if (r) {
        // Ratio locked: follow the larger drag direction, the other side adjusts
        let w =
          Math.abs(dx) >= Math.abs(dy * r)
            ? snap(o.w + dx, [W - o.x, W / 2 - o.x], distance)
            : snap(o.h + dy, [H - o.y, H / 2 - o.y], distance) * r;
        w = Math.max(60, Math.min(w, W - o.x, (H - o.y) * r));
        s.w = Math.round(w);
        s.h = Math.round(w / r);
      } else {
        s.w = Math.round(Math.max(60, snap(o.w + dx, [W - o.x, W / 2 - o.x], distance)));
        s.h = Math.round(Math.max(60, snap(o.h + dy, [H - o.y, H / 2 - o.y], distance)));
      }
    } else {
      const t = te.tpl.texts[i],
        o = start.obj;
      t.x = Math.round(snap(o.x + dx, [W / 2], distance));
      t.y = Math.round(Math.min(H, Math.max(0, o.y + dy)));
    }
    te.dirty = true;
    drawEditor();
  });
  const release = () => {
    start = null;
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
}

/* ---------------- Right panel ---------------- */
function setEditorTab(tab) {
  const previous = te.tab;
  te.tab = tab;
  document.querySelectorAll('.te-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  document.querySelectorAll('.te-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === tab));
  if (te.tpl && (tab === 'filter' || previous === 'filter')) drawEditor();
}

/* ---------------- Photo filter (LUT .cube) ---------------- */
const templateFilterName = () => {
  const f = te.filterList.find(x => x.id === te.tpl.filter);
  return f ? f.nama : '';
};
// Preview: sample photo with the chosen filter (used in the editor's photo boxes)
async function updateFilterSample() {
  const t = te.tpl;
  if (!t) return;
  const item = t.filter ? await loadLut(t.filter) : null;
  if (te.tpl !== t) return;
  te.samplePhoto = item ? applyLut(sampleFilterPhoto(), item.lut, (t.filterKekuatan ?? 100) / 100, 600) : null;
  if (te.tab === 'filter') drawEditor();
}
let filterTurn = 0;
async function fillFilterPanel() {
  const t = te.tpl;
  if (!t) return;
  const turn = ++filterTurn; // the newer call wins
  const stillCurrent = () => te.tpl === t && turn === filterTurn;
  let items = [];
  try {
    items = (api.filterDaftar && (await api.filterDaftar())) || [];
  } catch (e) {
    console.warn('Filter list could not be loaded: ' + e.message);
  }
  if (!stillCurrent()) return;
  te.filterList = items;
  if (t.filter && !items.some(f => f.id === t.filter)) t.filter = null; // the filter was deleted
  const prepared = await Promise.all(items.map(f => loadLut(f.id)));
  if (!stillCurrent()) return;
  const box = $('teFilter');
  box.innerHTML = '';
  const sample = sampleFilterPhoto();
  const addOption = (lut, name, active, onPick) => {
    const b = optionButton(box, applyLut(sample, lut, lut ? (t.filterKekuatan ?? 100) / 100 : 0, 150), active, onPick);
    b.insertAdjacentText('beforeend', name);
    return b;
  };
  addOption(null, 'No filter', !t.filter, () => chooseTemplateFilter(null));
  for (const [i, f] of items.entries()) {
    const item = prepared[i];
    if (!item) continue;
    addOption(item.lut, f.nama, t.filter === f.id, () => chooseTemplateFilter(f.id)).dataset.filter = f.id;
  }
  const exists = !!t.filter,
    k = t.filterKekuatan ?? 100;
  $('teFilterAtur').style.display = exists ? '' : 'none';
  $('teFilterHapus').style.display = exists ? '' : 'none';
  $('teFilterKekuatan').value = k;
  $('teFilterKekuatanNilai').textContent = k + '%';
  $('teFilterTamu').checked = t.filterTamu !== false;
  $('teFilterInfo').textContent = !exists
    ? te.filterList.length
      ? 'This template has no filter yet. Pick one above.'
      : 'No filters yet. Press "Add filter (.cube)" to upload a filter file.'
    : `All guest photos use the "${templateFilterName()}" filter (${k}%). ` +
      (t.filterTamu !== false ? 'Guests can still choose another filter while editing.' : "Guests can't change it.");
  deleteFilterArmed = null;
  $('teFilterHapus').lastChild.textContent = 'Delete this filter';
  updateFilterSample();
}
function chooseTemplateFilter(id) {
  te.tpl.filter = id;
  te.dirty = true;
  fillFilterPanel();
}
async function addFilter(file) {
  if (!file) return;
  if (!/\.cube$/i.test(file.name)) return flash('teMsg', 'Choose a filter file ending in .cube (3D LUT).', true);
  if (file.size > 20 * 1024 * 1024) return flash('teMsg', 'The filter file is too large (max 20 MB).', true);
  const r = await api.filterTambah(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!r || r.error) return flash('teMsg', (r && r.error) || 'Could not add the filter.', true);
  flash('teMsg', `Filter "${r.filter.nama}" added and applied to this template.`);
  te.tpl.filter = r.filter.id;
  te.dirty = true;
  fillFilterPanel();
}
async function deleteSelectedFilter() {
  const id = te.tpl.filter;
  if (!id) return;
  if (deleteFilterArmed !== id) {
    // press twice: the filter is removed from ALL templates
    deleteFilterArmed = id;
    $('teFilterHapus').lastChild.textContent = 'Sure? Removes it from every template';
    setTimeout(() => {
      if (deleteFilterArmed === id) {
        deleteFilterArmed = null;
        $('teFilterHapus').lastChild.textContent = 'Delete this filter';
      }
    }, 3000);
    return;
  }
  const name = templateFilterName();
  const r = await api.filterHapus(id);
  if (!r || r.error) return flash('teMsg', (r && r.error) || 'Could not delete the filter.', true);
  forgetLut(id);
  te.tpl.filter = null;
  te.dirty = true;
  flash('teMsg', `Filter "${name}" deleted from your collection.`);
  fillFilterPanel();
}
function optionButton(box, content, active, onClick, cls = 'pe-opt') {
  const b = document.createElement('button');
  b.className = cls + (active ? ' on' : '');
  if (typeof content === 'string') b.innerHTML = content;
  else b.appendChild(content);
  b.onclick = onClick;
  box.appendChild(b);
  return b;
}
function markDirty() {
  te.dirty = true;
  drawEditor();
  fillEditorPanel();
}
function fillEditorPanel() {
  const t = te.tpl;
  // Size
  const sizeInfo = $('teUkuran');
  sizeInfo.innerHTML = '';
  for (const [key, u] of Object.entries(TEMPLATE_SIZES)) {
    const k = 54 / Math.max(u.W, u.H);
    optionButton(
      sizeInfo,
      `<span class="te-kertas" style="width:${u.W * k}px;height:${u.H * k}px"></span>${u.nama}`,
      t.ukuran === key,
      () => changeSize(key),
    );
  }
  $('teUkuranInfo').textContent = `(${t.W}×${t.H} piksel)`;
  // Background color
  const wl = $('teWarnaLatar');
  wl.innerHTML = '';
  for (const w of BACKGROUND_COLORS) {
    const b = optionButton(
      wl,
      '',
      t.latarWarna.toLowerCase() === w.toLowerCase(),
      () => {
        t.latarWarna = w;
        markDirty();
      },
      'pe-dot',
    );
    b.style.background = w;
    b.setAttribute('aria-label', 'Warna latar ' + w);
  }
  const cw = document.createElement('input');
  cw.type = 'color';
  cw.className = 'te-warna';
  cw.value = t.latarWarna;
  cw.oninput = e => {
    t.latarWarna = e.target.value.toUpperCase();
    te.dirty = true;
    drawEditor();
  };
  cw.onchange = () => fillEditorPanel();
  wl.appendChild(cw);
  // Photo ratio (required; photo boxes keep this ratio when resized)
  const ra = $('teRasio');
  ra.innerHTML = '';
  for (const [key, value] of PHOTO_RATIOS) {
    const [w, h] = fitRatio(30, 30, value);
    optionButton(
      ra,
      `<span class="te-rasio" style="width:${w}px;height:${h}px"></span>${key}`,
      t.rasio === key,
      () => chooseRatio(key),
      'pe-opt te-rasio-opt',
    );
  }
  $('teRasioInfo').textContent = !t.rasio
    ? '⚠️ This template has no photo ratio yet. Pick one so guest photos fit their boxes.'
    : `All photos use a ${t.rasio} ratio. ${t.rasio === '3:2' ? 'Same as Sony camera photos, so nothing is cropped.' : 'Camera photos (3:2) will be cropped; guests see the safe area while shooting.'}`;
  // Quick arrangements
  const su = $('teSusunan');
  su.innerHTML = '';
  for (const [key, name] of ARRANGEMENTS) {
    const c = document.createElement('canvas'),
      k = 70 / Math.max(t.W, t.H);
    c.width = Math.round(t.W * k);
    c.height = Math.round(t.H * k);
    const rs = ratioValue(t.rasio);
    drawTemplate(
      c.getContext('2d'),
      { tpl: { ...t, slots: photoArrangement(key, t.W, t.H, rs), texts: [] }, background: null, frame: null },
      { scale: k, placeholder: true },
    );
    const b = optionButton(su, c, false, () => {
      t.slots = photoArrangement(key, t.W, t.H, rs);
      markDirty();
    });
    b.insertAdjacentText('beforeend', name);
  }
  // Selected photo
  const sp = $('teSlotPilih');
  sp.innerHTML = '';
  t.slots.forEach((s, i) =>
    optionButton(
      sp,
      `Photo ${i + 1}`,
      te.sel.kind === 'slot' && te.sel.i === i,
      () => {
        te.sel = { kind: 'slot', i };
        fillEditorPanel();
        placeHandles();
      },
      'btn sm tint',
    ),
  );
  $('teSudut').value = t.slots[0] ? t.slots[0].r : 8;
  // Text
  const tl = $('teTeksList');
  tl.innerHTML = '';
  if (!t.texts.length) {
    const k = document.createElement('div');
    k.className = 'item muted';
    k.textContent = 'No text yet.';
    tl.appendChild(k);
  }
  t.texts.forEach((x, i) => {
    const b = document.createElement('button');
    b.className = 'item nav-row' + (te.sel.kind === 'teks' && te.sel.i === i ? ' te-aktif' : '');
    b.innerHTML = '<span></span><svg class="i chev"><use href="#i-next"/></svg>';
    b.querySelector('span').textContent = x.text || '(empty)';
    b.onclick = () => {
      te.sel = { kind: 'teks', i };
      fillEditorPanel();
      placeHandles();
    };
    tl.appendChild(b);
  });
  const tx = te.sel.kind === 'teks' ? t.texts[te.sel.i] : null;
  $('teTeksEdit').style.display = tx ? '' : 'none';
  if (tx) {
    if (document.activeElement !== $('teTeksIsi')) $('teTeksIsi').value = tx.text;
    $('teTeksUkuran').value = tx.size;
    const fo = $('teTeksFont');
    fo.innerHTML = '';
    for (const [key, name] of Object.entries(FONT_NAMES)) {
      const b = optionButton(
        fo,
        '',
        tx.font === key,
        () => {
          tx.font = key;
          markDirty();
        },
        'btn sm tint',
      );
      b.textContent = name;
      b.style.fontFamily = TEMPLATE_FONTS[key];
    }
    const wt = $('teTeksWarna');
    wt.innerHTML = '';
    const items = [
      ...new Set([
        ...TEXT_COLORS,
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase(),
      ]),
    ];
    for (const w of items) {
      const b = optionButton(
        wt,
        '',
        tx.color.toLowerCase() === w.toLowerCase(),
        () => {
          tx.color = w;
          markDirty();
        },
        'pe-dot',
      );
      b.style.background = w;
      b.setAttribute('aria-label', 'Text color ' + w);
    }
    const ci = document.createElement('input');
    ci.type = 'color';
    ci.className = 'te-warna';
    ci.value = tx.color;
    ci.oninput = e => {
      tx.color = e.target.value.toUpperCase();
      te.dirty = true;
      drawEditor();
    };
    ci.onchange = () => fillEditorPanel();
    wt.appendChild(ci);
    $('teTeksTebal').classList.toggle('primary', !!tx.bold);
    $('teTeksTebal').classList.toggle('tint', !tx.bold);
  }
}
// Change ratio: every photo box is adjusted (center & area stay the same)
function chooseRatio(key) {
  const t = te.tpl,
    r = ratioValue(key);
  t.rasio = key;
  t.slots = t.slots.map(s => applyRatio(s, r, t.W, t.H));
  // If the boxes end up overlapping, tidy them into a 2×2 grid
  const stack = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  if (t.slots.some((a, i) => t.slots.some((b, j) => j > i && stack(a, b)))) {
    t.slots = photoArrangement('kisi', t.W, t.H, r).map((s, i) => ({ ...s, r: t.slots[i].r }));
    flash('teMsg', "Photo boxes were rearranged into a grid so they don't overlap.");
  }
  markDirty();
}
function changeSize(key) {
  const t = te.tpl,
    u = TEMPLATE_SIZES[key];
  if (t.ukuran === key) return;
  const sx = u.W / t.W,
    sy = u.H / t.H,
    sm = Math.min(sx, sy),
    r = ratioValue(t.rasio);
  t.slots = t.slots.map(s => ({
    ...s,
    x: Math.round(s.x * sx),
    y: Math.round(s.y * sy),
    w: Math.round(s.w * sx),
    h: Math.round(s.h * sy),
  }));
  if (r) t.slots = t.slots.map(s => applyRatio(s, r, u.W, u.H)); // photo ratio stays even when the paper size changes
  t.texts = t.texts.map(x => ({
    ...x,
    x: Math.round(x.x * sx),
    y: Math.round(x.y * sy),
    size: Math.max(10, Math.round(x.size * sm)),
  }));
  Object.assign(t, { ukuran: key, W: u.W, H: u.H });
  te.dirty = true;
  fillEditorPanel();
  fitEditorCanvas();
}

// Upload a background / frame image from Canva, Photoshop, etc.
async function chooseImage(file, kind) {
  if (!file) return;
  if (kind === 'bingkai' && file.type !== 'image/png')
    return flash('teMsg', 'The frame must be a PNG so the photo areas can be transparent.', true);
  if (!/^image\/(png|jpeg)$/.test(file.type)) return flash('teMsg', 'Choose a PNG or JPG image.', true);
  if (file.size > 25 * 1024 * 1024) return flash('teMsg', 'The image is too large (max 25 MB).', true);
  te.images[kind] = new Uint8Array(await file.arrayBuffer());
  te[kind] = await loadImage(URL.createObjectURL(file));
  $(kind === 'latar' ? 'teLatarStatus' : 'teBingkaiStatus').textContent = file.name;
  const img = te[kind];
  if (img && Math.abs(img.naturalWidth / img.naturalHeight - te.tpl.W / te.tpl.H) > 0.02)
    flash(
      'teMsg',
      `The image proportions differ from the template size (${te.tpl.W}×${te.tpl.H}). It will be cropped or stretched.`,
      true,
    );
  te.dirty = true;
  drawEditor();
}
function removeTemplateImage(kind) {
  te.images[kind] = null;
  te[kind] = null;
  $(kind === 'latar' ? 'teLatarStatus' : 'teBingkaiStatus').textContent = 'None';
  te.dirty = true;
  drawEditor();
}

/* ---------------- Save / cancel ---------------- */
async function saveTemplateEdits() {
  if (!te.tpl.rasio) {
    setEditorTab('foto');
    return flash('teMsg', 'Choose a photo ratio first (Photo layout tab).', true);
  }
  te.tpl.nama = $('teNama').value.trim() || 'Template ' + new Date().toLocaleDateString('en-GB');
  const r = await api.saveTemplate(te.tpl, te.images);
  if (r.error) return flash('teMsg', r.error, true);
  te.dirty = false;
  show('tambah');
  await listCoupleTemplates();
  flash('tplMsg', `Template "${r.template.nama}" saved.`);
}
function disarmCancel() {
  clearTimeout(te.cancelArmed);
  te.cancelArmed = null;
  $('teBatal').textContent = 'Cancel';
}
function cancelEditor() {
  if (te.dirty && !te.cancelArmed) {
    // unsaved changes: press twice
    $('teBatal').textContent = 'Buang perubahan?';
    te.cancelArmed = setTimeout(disarmCancel, 3000);
    return;
  }
  disarmCancel();
  te.tpl = null;
  show('tambah');
}

// Wire up this feature's buttons (called once from start.js)
export function setupTemplateEditor() {
  $('btnTplNew').onclick = () => openTemplateEditor(null);
  $('teBatal').onclick = cancelEditor;
  $('teSimpan').onclick = saveTemplateEdits;
  document.querySelectorAll('.te-tab').forEach(t => (t.onclick = () => setEditorTab(t.dataset.tab)));
  $('teNama').oninput = () => {
    te.dirty = true;
  };
  $('teLatarPilih').onclick = () => $('teLatarFile').click();
  $('teBingkaiPilih').onclick = () => $('teBingkaiFile').click();
  $('teLatarFile').onchange = e => {
    chooseImage(e.target.files[0], 'latar');
    e.target.value = '';
  };
  $('teBingkaiFile').onchange = e => {
    chooseImage(e.target.files[0], 'bingkai');
    e.target.value = '';
  };
  $('teLatarHapus').onclick = () => removeTemplateImage('latar');
  $('teBingkaiHapus').onclick = () => removeTemplateImage('bingkai');
  $('teSudut').oninput = e => {
    te.tpl.slots.forEach(s => {
      s.r = Number(e.target.value);
    });
    te.dirty = true;
    drawEditor();
  };
  $('teSlotTukar').onclick = () => {
    const i = te.sel.kind === 'slot' ? te.sel.i : 0,
      j = (i + 1) % 4,
      s = te.tpl.slots;
    [s[i], s[j]] = [s[j], s[i]];
    te.sel = { kind: 'slot', i: j };
    flash('teMsg', `Photos ${i + 1} and ${j + 1} swapped.`);
    markDirty();
  };
  $('teTeksTambah').onclick = () => {
    const { W, H } = te.tpl;
    te.tpl.texts.push({
      id: 't' + Date.now(),
      text: 'New text',
      x: W / 2,
      y: H / 2,
      size: Math.round(Math.min(W, H) * 0.06),
      color: '#1D1D1F',
      font: 'sans',
      bold: false,
    });
    te.sel = { kind: 'teks', i: te.tpl.texts.length - 1 };
    markDirty();
    $('teTeksIsi').focus();
    $('teTeksIsi').select();
  };
  const selectedText = () => (te.sel.kind === 'teks' ? te.tpl.texts[te.sel.i] : null);
  $('teTeksIsi').oninput = e => {
    const t = selectedText();
    if (!t) return;
    t.text = e.target.value;
    te.dirty = true;
    drawEditor();
    const label = $('teTeksList').children[te.sel.i]; // update the name in the list without rebuilding the panel
    if (label && label.querySelector('span')) label.querySelector('span').textContent = t.text || '(empty)';
  };
  $('teTeksUkuran').oninput = e => {
    const t = selectedText();
    if (!t) return;
    t.size = Number(e.target.value);
    te.dirty = true;
    drawEditor();
  };
  $('teTeksTebal').onclick = () => {
    const t = selectedText();
    if (t) {
      t.bold = !t.bold;
      markDirty();
    }
  };
  $('teTeksTengah').onclick = () => {
    const t = selectedText();
    if (t) {
      t.x = te.tpl.W / 2;
      markDirty();
    }
  };
  $('teTeksHapus').onclick = () => {
    if (te.sel.kind !== 'teks') return;
    te.tpl.texts.splice(te.sel.i, 1);
    te.sel = { kind: 'slot', i: 0 };
    markDirty();
  };
  $('teFilterTambah').onclick = () => $('teFilterFile').click();
  $('teFilterFile').onchange = e => {
    addFilter(e.target.files[0]);
    e.target.value = '';
  };
  $('teFilterHapus').onclick = deleteSelectedFilter;
  let strengthTimer = null;
  $('teFilterKekuatan').oninput = e => {
    te.tpl.filterKekuatan = Number(e.target.value);
    te.dirty = true;
    $('teFilterKekuatanNilai').textContent = te.tpl.filterKekuatan + '%';
    cancelAnimationFrame(strengthTimer);
    strengthTimer = requestAnimationFrame(updateFilterSample);
  };
  $('teFilterKekuatan').onchange = () => fillFilterPanel();
  $('teFilterTamu').onchange = e => {
    te.tpl.filterTamu = e.target.checked;
    te.dirty = true;
    fillFilterPanel();
  };
  window.addEventListener('resize', () => {
    if ($('tpleditor').classList.contains('on')) fitEditorCanvas();
  });
}
