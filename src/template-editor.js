/* =====================================================================
   template-editor.js — daftar template & editor template desain foto
   (Admin → Pengaturan photobooth). Template disimpan per couple aktif.
   Penggambarannya memakai template-gambar.js, sama dengan hasil tamu.
   ===================================================================== */

const UKURAN_TEMPLATE = {
  '4r-tegak': { W: 1200, H: 1800, nama: '4R portrait (4×6)' },
  '4r-datar': { W: 1800, H: 1200, nama: '4R landscape (6×4)' },
  strip: { W: 600, H: 1800, nama: 'Strip 2×6' },
  persegi: { W: 1200, H: 1200, nama: 'Square' },
};
const SUSUNAN = [
  ['kisi', 'Grid 2×2'],
  ['kolom', 'Column'],
  ['baris', 'Row'],
  ['besar', '1 big + 3'],
];
const WARNA_LATAR = ['#FFFFFF', '#F3EDE4', '#F6E1E3', '#E3EBE1', '#E6ECF5', '#1D1D1F'];
const WARNA_TEKS = ['#1D1D1F', '#FFFFFF', '#6E6E73', '#8C6A4F', '#5B3A40', '#2F4030'];

const te = {
  tpl: null,
  gambar: {},
  latar: null,
  bingkai: null,
  sel: { jenis: 'slot', i: 0 },
  berubah: false,
  batalArmed: null,
  tab: 'desain',
  contohFoto: null,
  filterDaftar: [],
};
let hapusFilterArmed = null;
let hapusTplArmed = null;
let coupleTemplate = null; // couple yang templatenya sedang diatur (bukan selalu couple aktif)

/* ---------------- Daftar template di halaman couple ---------------- */
async function daftarTemplateCouple(couple = coupleTemplate) {
  coupleTemplate = couple;
  if (current === 'tambah' || current === 'tpleditor') namaCoupleTemplate = couple ? couple.name : null;
  const box = $('tplList');
  box.innerHTML = '';
  const list = couple ? await api.listTemplates(couple.id) : [];
  if (couple !== coupleTemplate) return; // sudah pindah ke couple lain
  if (!list.length) {
    const kosong = document.createElement('div');
    kosong.className = 'item muted';
    kosong.textContent = 'No templates yet. Guests use the built-in layouts (Grid 2×2, Strip, 1 big + 3).';
    box.appendChild(kosong);
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
    siapkanTemplate(t).then(siap => gambarTemplate(mini.getContext('2d'), siap, { scale: k, placeholder: true }));
    const info = document.createElement('div');
    info.className = 'tpl-info';
    info.innerHTML = `<b></b><span class="muted"></span>`;
    info.querySelector('b').textContent = t.nama;
    info.querySelector('span').textContent =
      ((UKURAN_TEMPLATE[t.ukuran] || {}).nama || t.ukuran) + (t.filter ? ' · with filter' : '');
    const edit = document.createElement('button');
    edit.className = 'btn sm tint';
    edit.textContent = 'Edit';
    edit.onclick = () => bukaEditorTemplate(t);
    const hapus = document.createElement('button');
    hapus.className = 'btn sm tint danger';
    hapus.textContent = 'Delete';
    hapus.onclick = async () => {
      if (hapusTplArmed !== t.id) {
        // tekan dua kali untuk konfirmasi
        hapusTplArmed = t.id;
        hapus.textContent = 'Delete for sure?';
        setTimeout(() => {
          if (hapusTplArmed === t.id) {
            hapusTplArmed = null;
            hapus.textContent = 'Delete';
          }
        }, 3000);
        return;
      }
      hapusTplArmed = null;
      const r = await api.deleteTemplate(t.id);
      if (r.error) flash('tplMsg', r.error, true);
      else flash('tplMsg', `Template "${t.nama}" deleted.`);
      daftarTemplateCouple();
    };
    row.append(mini, info, edit, hapus);
    box.appendChild(row);
  }
}

/* ---------------- Membuka editor ---------------- */
function templateBaru() {
  const { W, H } = UKURAN_TEMPLATE['4r-tegak'];
  return {
    id: 'tpl' + Date.now(),
    coupleId: coupleTemplate.id,
    nama: '',
    ukuran: '4r-tegak',
    W,
    H,
    latarWarna: '#FFFFFF',
    rasio: '3:2',
    filter: null,
    filterKekuatan: 100,
    filterTamu: true,
    slots: susunanFoto('kisi', W, H, 3 / 2),
    texts: teksBawaan(W, H),
  };
}
async function bukaEditorTemplate(tpl) {
  if (!coupleTemplate) return flash('tplMsg', 'Save this couple first.', true);
  te.tpl = tpl ? JSON.parse(JSON.stringify({ ...tpl, latarUrl: undefined, bingkaiUrl: undefined })) : templateBaru();
  te.gambar = {};
  te.latar = tpl ? await muatGambar(tpl.latarUrl) : null;
  te.bingkai = tpl ? await muatGambar(tpl.bingkaiUrl) : null;
  te.sel = { jenis: 'slot', i: 0 };
  te.berubah = false;
  te.contohFoto = null;
  batalTidakJadi();
  if (te.tpl.filterKekuatan == null) te.tpl.filterKekuatan = 100;
  if (te.tpl.filterTamu == null) te.tpl.filterTamu = true;
  $('teTitle').textContent = (tpl ? 'Edit template' : 'New template') + ' · ' + coupleTemplate.name;
  $('teNama').value = te.tpl.nama;
  $('teLatarStatus').textContent = te.latar ? 'Image added' : 'None';
  $('teBingkaiStatus').textContent = te.bingkai ? 'Frame added' : 'None';
  show('tpleditor');
  setTabEditor('desain');
  isiPanelEditor();
  isiPanelFilter();
  requestAnimationFrame(pasCanvasEditor);
}

/* ---------------- Gambar & kotak pegangan ---------------- */
const skalaEditor = () => $('teBox').getBoundingClientRect().width / te.tpl.W;
function pasCanvasEditor() {
  if (!te.tpl) return;
  const st = $('teStage').getBoundingClientRect();
  const k = Math.min((st.width - 48) / te.tpl.W, (st.height - 48) / te.tpl.H);
  $('teBox').style.width = Math.floor(te.tpl.W * k) + 'px';
  $('teBox').style.height = Math.floor(te.tpl.H * k) + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  $('teCanvas').width = Math.round(te.tpl.W * k * dpr);
  $('teCanvas').height = Math.round(te.tpl.H * k * dpr);
  gambarEditor();
}
function gambarEditor() {
  const c = $('teCanvas'),
    ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  // Di tab Filter, kotak foto diisi foto contoh yang sudah difilter supaya hasilnya terlihat
  const photos = te.tab === 'filter' ? Array(4).fill(te.contohFoto || sampleFilterPhoto()) : [];
  gambarTemplate(
    ctx,
    { tpl: te.tpl, latar: te.latar, bingkai: te.bingkai },
    { scale: c.width / te.tpl.W, placeholder: true, photos },
  );
  pasangPegangan();
}
/* Kotak pegangan di atas gambar. Kotak yang sudah ada hanya dipindah (tidak
   dibuat ulang) supaya jari yang sedang menggeser tidak "terlepas". */
function pasangPegangan() {
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
      geserDenganJari(el, 'slot', i);
      geserDenganJari(el.querySelector('.te-resize'), 'resize', i);
      box.appendChild(el);
    });
    te.tpl.texts.forEach((t, i) => {
      const el = document.createElement('div');
      el.className = 'te-text';
      geserDenganJari(el, 'teks', i);
      box.appendChild(el);
    });
    return pasangPegangan();
  }
  te.tpl.slots.forEach((s, i) => {
    const el = slots[i];
    el.classList.toggle('sel', te.sel.jenis === 'slot' && te.sel.i === i);
    Object.assign(el.style, { left: pct(s.x, W), top: pct(s.y, H), width: pct(s.w, W), height: pct(s.h, H) });
  });
  te.tpl.texts.forEach((t, i) => {
    const el = texts[i],
      w = lebarTeks(t) + t.size * 0.4,
      h = t.size * 1.3;
    el.classList.toggle('sel', te.sel.jenis === 'teks' && te.sel.i === i);
    Object.assign(el.style, {
      left: pct(t.x - w / 2, W),
      top: pct(t.y - h / 2, H),
      width: pct(w, W),
      height: pct(h, H),
    });
  });
}

// Tempel otomatis ke tengah & tepi kalau sudah dekat
function tempel(nilai, kandidat, jarak) {
  for (const k of kandidat) if (Math.abs(nilai - k) <= jarak) return k;
  return nilai;
}
function geserDenganJari(el, jenis, i) {
  let awal = null;
  el.addEventListener('pointerdown', e => {
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const obj = jenis === 'teks' ? te.tpl.texts[i] : te.tpl.slots[i];
    awal = { x: e.clientX, y: e.clientY, obj: { ...obj } };
    te.sel = { jenis: jenis === 'teks' ? 'teks' : 'slot', i };
    isiPanelEditor();
    pasangPegangan();
    resetIdle();
    if (jenis !== 'teks') setTabEditor('foto');
    else setTabEditor('teks');
  });
  el.addEventListener('pointermove', e => {
    if (!awal) return;
    const k = skalaEditor(),
      dx = (e.clientX - awal.x) / k,
      dy = (e.clientY - awal.y) / k;
    const { W, H } = te.tpl,
      jarak = 12 / k;
    if (jenis === 'slot') {
      const s = te.tpl.slots[i],
        o = awal.obj;
      s.x = Math.round(tempel(o.x + dx, [0, W / 2 - o.w / 2, W - o.w], jarak));
      s.y = Math.round(tempel(o.y + dy, [0, H / 2 - o.h / 2, H - o.h], jarak));
    } else if (jenis === 'resize') {
      const s = te.tpl.slots[i],
        o = awal.obj,
        r = nilaiRasio(te.tpl.rasio);
      if (r) {
        // Rasio terkunci: ikuti arah tarikan yang paling besar, sisi lainnya menyesuaikan
        let w =
          Math.abs(dx) >= Math.abs(dy * r)
            ? tempel(o.w + dx, [W - o.x, W / 2 - o.x], jarak)
            : tempel(o.h + dy, [H - o.y, H / 2 - o.y], jarak) * r;
        w = Math.max(60, Math.min(w, W - o.x, (H - o.y) * r));
        s.w = Math.round(w);
        s.h = Math.round(w / r);
      } else {
        s.w = Math.round(Math.max(60, tempel(o.w + dx, [W - o.x, W / 2 - o.x], jarak)));
        s.h = Math.round(Math.max(60, tempel(o.h + dy, [H - o.y, H / 2 - o.y], jarak)));
      }
    } else {
      const t = te.tpl.texts[i],
        o = awal.obj;
      t.x = Math.round(tempel(o.x + dx, [W / 2], jarak));
      t.y = Math.round(Math.min(H, Math.max(0, o.y + dy)));
    }
    te.berubah = true;
    gambarEditor();
  });
  const lepas = () => {
    awal = null;
  };
  el.addEventListener('pointerup', lepas);
  el.addEventListener('pointercancel', lepas);
}

/* ---------------- Panel kanan ---------------- */
function setTabEditor(tab) {
  const tadi = te.tab;
  te.tab = tab;
  document.querySelectorAll('.te-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  document.querySelectorAll('.te-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === tab));
  if (te.tpl && (tab === 'filter' || tadi === 'filter')) gambarEditor();
}

/* ---------------- Filter foto (LUT .cube) ---------------- */
const namaFilterTpl = () => {
  const f = te.filterDaftar.find(x => x.id === te.tpl.filter);
  return f ? f.nama : '';
};
// Pratinjau: foto contoh dengan filter terpilih (dipakai di kotak foto editor)
async function perbaruiContohFilter() {
  const t = te.tpl;
  if (!t) return;
  const item = t.filter ? await loadLut(t.filter) : null;
  if (te.tpl !== t) return;
  te.contohFoto = item ? applyLut(sampleFilterPhoto(), item.lut, (t.filterKekuatan ?? 100) / 100, 600) : null;
  if (te.tab === 'filter') gambarEditor();
}
let giliranFilter = 0;
async function isiPanelFilter() {
  const t = te.tpl;
  if (!t) return;
  const giliran = ++giliranFilter; // panggilan yang lebih baru menang
  const masihBerlaku = () => te.tpl === t && giliran === giliranFilter;
  let daftar = [];
  try {
    daftar = (api.filterDaftar && (await api.filterDaftar())) || [];
  } catch (e) {
    console.warn('Filter list could not be loaded: ' + e.message);
  }
  if (!masihBerlaku()) return;
  te.filterDaftar = daftar;
  if (t.filter && !daftar.some(f => f.id === t.filter)) t.filter = null; // filternya sudah dihapus
  const siap = await Promise.all(daftar.map(f => loadLut(f.id)));
  if (!masihBerlaku()) return;
  const box = $('teFilter');
  box.innerHTML = '';
  const contoh = sampleFilterPhoto();
  const kotak = (lut, nama, aktif, pilih) => {
    const b = tombolPilihan(box, applyLut(contoh, lut, lut ? (t.filterKekuatan ?? 100) / 100 : 0, 150), aktif, pilih);
    b.insertAdjacentText('beforeend', nama);
    return b;
  };
  kotak(null, 'No filter', !t.filter, () => pilihFilterTemplate(null));
  for (const [i, f] of daftar.entries()) {
    const item = siap[i];
    if (!item) continue;
    kotak(item.lut, f.nama, t.filter === f.id, () => pilihFilterTemplate(f.id)).dataset.filter = f.id;
  }
  const ada = !!t.filter,
    k = t.filterKekuatan ?? 100;
  $('teFilterAtur').style.display = ada ? '' : 'none';
  $('teFilterHapus').style.display = ada ? '' : 'none';
  $('teFilterKekuatan').value = k;
  $('teFilterKekuatanNilai').textContent = k + '%';
  $('teFilterTamu').checked = t.filterTamu !== false;
  $('teFilterInfo').textContent = !ada
    ? te.filterDaftar.length
      ? 'This template has no filter yet. Pick one above.'
      : 'No filters yet. Press "Add filter (.cube)" to upload a filter file.'
    : `All guest photos use the "${namaFilterTpl()}" filter (${k}%). ` +
      (t.filterTamu !== false ? 'Guests can still choose another filter while editing.' : "Guests can't change it.");
  hapusFilterArmed = null;
  $('teFilterHapus').lastChild.textContent = 'Delete this filter';
  perbaruiContohFilter();
}
function pilihFilterTemplate(id) {
  te.tpl.filter = id;
  te.berubah = true;
  isiPanelFilter();
}
async function tambahFilter(file) {
  if (!file) return;
  if (!/\.cube$/i.test(file.name)) return flash('teMsg', 'Choose a filter file ending in .cube (3D LUT).', true);
  if (file.size > 20 * 1024 * 1024) return flash('teMsg', 'The filter file is too large (max 20 MB).', true);
  const r = await api.filterTambah(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!r || r.error) return flash('teMsg', (r && r.error) || 'Could not add the filter.', true);
  flash('teMsg', `Filter "${r.filter.nama}" added and applied to this template.`);
  te.tpl.filter = r.filter.id;
  te.berubah = true;
  isiPanelFilter();
}
async function hapusFilterTerpilih() {
  const id = te.tpl.filter;
  if (!id) return;
  if (hapusFilterArmed !== id) {
    // tekan dua kali: filter hilang dari SEMUA template
    hapusFilterArmed = id;
    $('teFilterHapus').lastChild.textContent = 'Sure? Removes it from every template';
    setTimeout(() => {
      if (hapusFilterArmed === id) {
        hapusFilterArmed = null;
        $('teFilterHapus').lastChild.textContent = 'Delete this filter';
      }
    }, 3000);
    return;
  }
  const nama = namaFilterTpl();
  const r = await api.filterHapus(id);
  if (!r || r.error) return flash('teMsg', (r && r.error) || 'Could not delete the filter.', true);
  forgetLut(id);
  te.tpl.filter = null;
  te.berubah = true;
  flash('teMsg', `Filter "${nama}" deleted from your collection.`);
  isiPanelFilter();
}
function tombolPilihan(box, isi, aktif, onClick, kelas = 'pe-opt') {
  const b = document.createElement('button');
  b.className = kelas + (aktif ? ' on' : '');
  if (typeof isi === 'string') b.innerHTML = isi;
  else b.appendChild(isi);
  b.onclick = onClick;
  box.appendChild(b);
  return b;
}
function tandaiBerubah() {
  te.berubah = true;
  gambarEditor();
  isiPanelEditor();
}
function isiPanelEditor() {
  const t = te.tpl;
  // Ukuran
  const uk = $('teUkuran');
  uk.innerHTML = '';
  for (const [key, u] of Object.entries(UKURAN_TEMPLATE)) {
    const k = 54 / Math.max(u.W, u.H);
    tombolPilihan(
      uk,
      `<span class="te-kertas" style="width:${u.W * k}px;height:${u.H * k}px"></span>${u.nama}`,
      t.ukuran === key,
      () => gantiUkuran(key),
    );
  }
  $('teUkuranInfo').textContent = `(${t.W}×${t.H} piksel)`;
  // Warna latar
  const wl = $('teWarnaLatar');
  wl.innerHTML = '';
  for (const w of WARNA_LATAR) {
    const b = tombolPilihan(
      wl,
      '',
      t.latarWarna.toLowerCase() === w.toLowerCase(),
      () => {
        t.latarWarna = w;
        tandaiBerubah();
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
    te.berubah = true;
    gambarEditor();
  };
  cw.onchange = () => isiPanelEditor();
  wl.appendChild(cw);
  // Rasio foto (wajib dipilih; besar kecil kotak foto mengikuti rasio ini)
  const ra = $('teRasio');
  ra.innerHTML = '';
  for (const [key, nilai] of RASIO_FOTO) {
    const [w, h] = muatRasio(30, 30, nilai);
    tombolPilihan(
      ra,
      `<span class="te-rasio" style="width:${w}px;height:${h}px"></span>${key}`,
      t.rasio === key,
      () => pilihRasio(key),
      'pe-opt te-rasio-opt',
    );
  }
  $('teRasioInfo').textContent = !t.rasio
    ? '⚠️ This template has no photo ratio yet. Pick one so guest photos fit their boxes.'
    : `All photos use a ${t.rasio} ratio. ${t.rasio === '3:2' ? 'Same as Sony camera photos, so nothing is cropped.' : 'Camera photos (3:2) will be cropped; guests see the safe area while shooting.'}`;
  // Susunan cepat
  const su = $('teSusunan');
  su.innerHTML = '';
  for (const [key, nama] of SUSUNAN) {
    const c = document.createElement('canvas'),
      k = 70 / Math.max(t.W, t.H);
    c.width = Math.round(t.W * k);
    c.height = Math.round(t.H * k);
    const rs = nilaiRasio(t.rasio);
    gambarTemplate(
      c.getContext('2d'),
      { tpl: { ...t, slots: susunanFoto(key, t.W, t.H, rs), texts: [] }, latar: null, bingkai: null },
      { scale: k, placeholder: true },
    );
    const b = tombolPilihan(su, c, false, () => {
      t.slots = susunanFoto(key, t.W, t.H, rs);
      tandaiBerubah();
    });
    b.insertAdjacentText('beforeend', nama);
  }
  // Foto terpilih
  const sp = $('teSlotPilih');
  sp.innerHTML = '';
  t.slots.forEach((s, i) =>
    tombolPilihan(
      sp,
      `Photo ${i + 1}`,
      te.sel.jenis === 'slot' && te.sel.i === i,
      () => {
        te.sel = { jenis: 'slot', i };
        isiPanelEditor();
        pasangPegangan();
      },
      'btn sm tint',
    ),
  );
  $('teSudut').value = t.slots[0] ? t.slots[0].r : 8;
  // Teks
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
    b.className = 'item nav-row' + (te.sel.jenis === 'teks' && te.sel.i === i ? ' te-aktif' : '');
    b.innerHTML = '<span></span><svg class="i chev"><use href="#i-next"/></svg>';
    b.querySelector('span').textContent = x.text || '(empty)';
    b.onclick = () => {
      te.sel = { jenis: 'teks', i };
      isiPanelEditor();
      pasangPegangan();
    };
    tl.appendChild(b);
  });
  const tx = te.sel.jenis === 'teks' ? t.texts[te.sel.i] : null;
  $('teTeksEdit').style.display = tx ? '' : 'none';
  if (tx) {
    if (document.activeElement !== $('teTeksIsi')) $('teTeksIsi').value = tx.text;
    $('teTeksUkuran').value = tx.size;
    const fo = $('teTeksFont');
    fo.innerHTML = '';
    for (const [key, nama] of Object.entries(NAMA_FONT)) {
      const b = tombolPilihan(
        fo,
        '',
        tx.font === key,
        () => {
          tx.font = key;
          tandaiBerubah();
        },
        'btn sm tint',
      );
      b.textContent = nama;
      b.style.fontFamily = FONT_TEMPLATE[key];
    }
    const wt = $('teTeksWarna');
    wt.innerHTML = '';
    const daftar = [
      ...new Set([
        ...WARNA_TEKS,
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase(),
      ]),
    ];
    for (const w of daftar) {
      const b = tombolPilihan(
        wt,
        '',
        tx.color.toLowerCase() === w.toLowerCase(),
        () => {
          tx.color = w;
          tandaiBerubah();
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
      te.berubah = true;
      gambarEditor();
    };
    ci.onchange = () => isiPanelEditor();
    wt.appendChild(ci);
    $('teTeksTebal').classList.toggle('primary', !!tx.bold);
    $('teTeksTebal').classList.toggle('tint', !tx.bold);
  }
}
// Ganti rasio: setiap kotak foto disesuaikan (titik tengah & luasnya tetap)
function pilihRasio(key) {
  const t = te.tpl,
    r = nilaiRasio(key);
  t.rasio = key;
  t.slots = t.slots.map(s => pasRasio(s, r, t.W, t.H));
  // Kalau kotak-kotaknya jadi saling tumpuk, rapikan ke susunan kisi 2×2
  const tumpuk = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  if (t.slots.some((a, i) => t.slots.some((b, j) => j > i && tumpuk(a, b)))) {
    t.slots = susunanFoto('kisi', t.W, t.H, r).map((s, i) => ({ ...s, r: t.slots[i].r }));
    flash('teMsg', "Photo boxes were rearranged into a grid so they don't overlap.");
  }
  tandaiBerubah();
}
function gantiUkuran(key) {
  const t = te.tpl,
    u = UKURAN_TEMPLATE[key];
  if (t.ukuran === key) return;
  const sx = u.W / t.W,
    sy = u.H / t.H,
    sm = Math.min(sx, sy),
    r = nilaiRasio(t.rasio);
  t.slots = t.slots.map(s => ({
    ...s,
    x: Math.round(s.x * sx),
    y: Math.round(s.y * sy),
    w: Math.round(s.w * sx),
    h: Math.round(s.h * sy),
  }));
  if (r) t.slots = t.slots.map(s => pasRasio(s, r, u.W, u.H)); // rasio foto tetap walau ukuran kertas berubah
  t.texts = t.texts.map(x => ({
    ...x,
    x: Math.round(x.x * sx),
    y: Math.round(x.y * sy),
    size: Math.max(10, Math.round(x.size * sm)),
  }));
  Object.assign(t, { ukuran: key, W: u.W, H: u.H });
  te.berubah = true;
  isiPanelEditor();
  pasCanvasEditor();
}

// Unggah gambar latar / bingkai dari Canva, Photoshop, dsb.
async function pilihGambar(file, jenis) {
  if (!file) return;
  if (jenis === 'bingkai' && file.type !== 'image/png')
    return flash('teMsg', 'The frame must be a PNG so the photo areas can be transparent.', true);
  if (!/^image\/(png|jpeg)$/.test(file.type)) return flash('teMsg', 'Choose a PNG or JPG image.', true);
  if (file.size > 25 * 1024 * 1024) return flash('teMsg', 'The image is too large (max 25 MB).', true);
  te.gambar[jenis] = new Uint8Array(await file.arrayBuffer());
  te[jenis] = await muatGambar(URL.createObjectURL(file));
  $(jenis === 'latar' ? 'teLatarStatus' : 'teBingkaiStatus').textContent = file.name;
  const img = te[jenis];
  if (img && Math.abs(img.naturalWidth / img.naturalHeight - te.tpl.W / te.tpl.H) > 0.02)
    flash(
      'teMsg',
      `The image proportions differ from the template size (${te.tpl.W}×${te.tpl.H}). It will be cropped or stretched.`,
      true,
    );
  te.berubah = true;
  gambarEditor();
}
function hapusGambarTemplate(jenis) {
  te.gambar[jenis] = null;
  te[jenis] = null;
  $(jenis === 'latar' ? 'teLatarStatus' : 'teBingkaiStatus').textContent = 'None';
  te.berubah = true;
  gambarEditor();
}

/* ---------------- Simpan / batal ---------------- */
async function simpanTemplate() {
  if (!te.tpl.rasio) {
    setTabEditor('foto');
    return flash('teMsg', 'Choose a photo ratio first (Photo layout tab).', true);
  }
  te.tpl.nama = $('teNama').value.trim() || 'Template ' + new Date().toLocaleDateString('en-GB');
  const r = await api.saveTemplate(te.tpl, te.gambar);
  if (r.error) return flash('teMsg', r.error, true);
  te.berubah = false;
  show('tambah');
  await daftarTemplateCouple();
  flash('tplMsg', `Template "${r.template.nama}" saved.`);
}
function batalTidakJadi() {
  clearTimeout(te.batalArmed);
  te.batalArmed = null;
  $('teBatal').textContent = 'Cancel';
}
function batalEditor() {
  if (te.berubah && !te.batalArmed) {
    // ada perubahan: tekan dua kali
    $('teBatal').textContent = 'Buang perubahan?';
    te.batalArmed = setTimeout(batalTidakJadi, 3000);
    return;
  }
  batalTidakJadi();
  te.tpl = null;
  show('tambah');
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari start.js)
function pasangTemplateEditor() {
  $('btnTplNew').onclick = () => bukaEditorTemplate(null);
  $('teBatal').onclick = batalEditor;
  $('teSimpan').onclick = simpanTemplate;
  document.querySelectorAll('.te-tab').forEach(t => (t.onclick = () => setTabEditor(t.dataset.tab)));
  $('teNama').oninput = () => {
    te.berubah = true;
  };
  $('teLatarPilih').onclick = () => $('teLatarFile').click();
  $('teBingkaiPilih').onclick = () => $('teBingkaiFile').click();
  $('teLatarFile').onchange = e => {
    pilihGambar(e.target.files[0], 'latar');
    e.target.value = '';
  };
  $('teBingkaiFile').onchange = e => {
    pilihGambar(e.target.files[0], 'bingkai');
    e.target.value = '';
  };
  $('teLatarHapus').onclick = () => hapusGambarTemplate('latar');
  $('teBingkaiHapus').onclick = () => hapusGambarTemplate('bingkai');
  $('teSudut').oninput = e => {
    te.tpl.slots.forEach(s => {
      s.r = Number(e.target.value);
    });
    te.berubah = true;
    gambarEditor();
  };
  $('teSlotTukar').onclick = () => {
    const i = te.sel.jenis === 'slot' ? te.sel.i : 0,
      j = (i + 1) % 4,
      s = te.tpl.slots;
    [s[i], s[j]] = [s[j], s[i]];
    te.sel = { jenis: 'slot', i: j };
    flash('teMsg', `Photos ${i + 1} and ${j + 1} swapped.`);
    tandaiBerubah();
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
    te.sel = { jenis: 'teks', i: te.tpl.texts.length - 1 };
    tandaiBerubah();
    $('teTeksIsi').focus();
    $('teTeksIsi').select();
  };
  const teksTerpilih = () => (te.sel.jenis === 'teks' ? te.tpl.texts[te.sel.i] : null);
  $('teTeksIsi').oninput = e => {
    const t = teksTerpilih();
    if (!t) return;
    t.text = e.target.value;
    te.berubah = true;
    gambarEditor();
    const label = $('teTeksList').children[te.sel.i]; // perbarui nama di daftar tanpa membuat ulang panel
    if (label && label.querySelector('span')) label.querySelector('span').textContent = t.text || '(empty)';
  };
  $('teTeksUkuran').oninput = e => {
    const t = teksTerpilih();
    if (!t) return;
    t.size = Number(e.target.value);
    te.berubah = true;
    gambarEditor();
  };
  $('teTeksTebal').onclick = () => {
    const t = teksTerpilih();
    if (t) {
      t.bold = !t.bold;
      tandaiBerubah();
    }
  };
  $('teTeksTengah').onclick = () => {
    const t = teksTerpilih();
    if (t) {
      t.x = te.tpl.W / 2;
      tandaiBerubah();
    }
  };
  $('teTeksHapus').onclick = () => {
    if (te.sel.jenis !== 'teks') return;
    te.tpl.texts.splice(te.sel.i, 1);
    te.sel = { jenis: 'slot', i: 0 };
    tandaiBerubah();
  };
  $('teFilterTambah').onclick = () => $('teFilterFile').click();
  $('teFilterFile').onchange = e => {
    tambahFilter(e.target.files[0]);
    e.target.value = '';
  };
  $('teFilterHapus').onclick = hapusFilterTerpilih;
  let tungguKekuatan = null;
  $('teFilterKekuatan').oninput = e => {
    te.tpl.filterKekuatan = Number(e.target.value);
    te.berubah = true;
    $('teFilterKekuatanNilai').textContent = te.tpl.filterKekuatan + '%';
    cancelAnimationFrame(tungguKekuatan);
    tungguKekuatan = requestAnimationFrame(perbaruiContohFilter);
  };
  $('teFilterKekuatan').onchange = () => isiPanelFilter();
  $('teFilterTamu').onchange = e => {
    te.tpl.filterTamu = e.target.checked;
    te.berubah = true;
    isiPanelFilter();
  };
  window.addEventListener('resize', () => {
    if ($('tpleditor').classList.contains('on')) pasCanvasEditor();
  });
}
