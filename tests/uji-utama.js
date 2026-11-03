/* =====================================================================
   uji-utama.js — uji proses utama (main.js dan folder main/)
   Jalankan:  node tests/uji-utama.js
   Setiap kasus berjalan di proses Node terpisah dengan folder data baru,
   jadi kasus yang satu tidak memengaruhi kasus lain.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const stream = require('stream');
const { spawnSync } = require('child_process');
const { cek, hasil, tunggu, nyalakanAplikasi } = require('./bantu');

const KASUS = {
  async 'couple: tambah, edit, ganti aktif, hapus'() {
    const { panggil } = nyalakanAplikasi();
    let d = await panggil('get-couples');
    cek(d.couples.length === 1 && d.couples[0].id === d.activeId, 'couple pertama dibuat dari config.json dan aktif');
    cek((await panggil('save-couple', { name: '  ', questions: ['a'] })).error === 'Nama couple wajib diisi.', 'nama kosong ditolak');
    cek((await panggil('save-couple', { name: 'X', questions: ['', ' '] })).error === 'Isi minimal 1 pertanyaan.', 'tanpa pertanyaan ditolak');
    let r = await panggil('save-couple', { name: 'Ayu & Budi', questions: Array.from({ length: 12 }, (_, i) => 'Q' + i) });
    cek(r.couple.questions.length === 10, 'pertanyaan dibatasi 10');
    cek(r.data.activeId !== r.couple.id, 'couple baru tidak otomatis aktif');
    r = await panggil('set-active-couple', r.couple.id);
    cek(r.ok, 'couple aktif bisa diganti');
    r = await panggil('save-couple', { ...r.data.couples[1], name: 'Ayu & Budi (edit)' });
    cek(r.data.couples.length === 2 && r.couple.name === 'Ayu & Budi (edit)', 'edit tidak menambah couple baru');
    r = await panggil('delete-couple', r.data.activeId);
    cek(r.ok && r.data.couples.length === 1 && r.data.activeId === r.data.couples[0].id, 'hapus couple aktif memindahkan status aktif');
    cek((await panggil('delete-couple', r.data.activeId)).error === 'Minimal harus ada 1 couple.', 'couple terakhir tidak bisa dihapus');
  },

  async 'pengaturan & login'() {
    const { panggil, dataDir } = nyalakanAplikasi();
    const awal = await panggil('get-settings');
    cek(awal.quizSeconds === 60 && awal.quizRounds === 3 && awal.kiosk === false, 'nilai awal dari config.json', awal);
    cek(await panggil('login', 'leura', '1234'), 'login awal leura/1234 berhasil');
    cek(!(await panggil('login', 'leura', '9999')), 'password salah ditolak');
    let s = await panggil('save-settings', { quizSeconds: 30, quizRounds: 5, accent: '#7C9A7E' });
    cek(s.quizSeconds === 30 && s.quizRounds === 5 && s.accent === '#7C9A7E', 'pengaturan tersimpan');
    s = await panggil('save-settings', { quizSeconds: 5000, quizRounds: -3, accent: 'merah' });
    cek(s.quizSeconds === 300 && s.quizRounds === 1 && s.accent === '#7C9A7E', 'nilai tidak masuk akal dibatasi', s);
    const c = await panggil('get-config');
    cek(c.quizSeconds === 300 && c.colors.accent === '#7C9A7E' && c.login === undefined, 'get-config ikut berubah dan tidak membocorkan login');
    cek((await panggil('change-login', '0000', 'bos', 'rahasia')).error === 'Password lama salah.', 'ganti login: password lama salah ditolak');
    cek((await panggil('change-login', '1234', 'bos', '12')).error === 'Password baru minimal 4 karakter.', 'ganti login: password pendek ditolak');
    cek((await panggil('change-login', '1234', 'bos', 'rahasia')).ok, 'ganti login berhasil');
    cek(!(await panggil('login', 'leura', '1234')) && await panggil('login', 'BOS', 'rahasia'), 'login lama tidak berlaku, login baru berlaku');
    cek(!fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8').includes('rahasia'), 'password tidak tersimpan sebagai teks biasa');
  },

  async 'file data rusak tidak menghapus data'() {
    const { panggil, dataDir } = nyalakanAplikasi();
    await panggil('save-couple', { name: 'Ayu & Budi', questions: ['a'] });
    await panggil('save-couple', { name: 'Citra & Doni', questions: ['b'] });
    const f = path.join(dataDir, 'couples.json');
    fs.writeFileSync(f, '{"activeId":"c1","coup');                       // simulasi listrik mati saat menulis
    let d = await panggil('get-couples');
    cek(d.couples.some(c => c.name === 'Ayu & Budi'), 'file rusak: data dibaca dari cadangan .bak');
    fs.writeFileSync(f, 'RUSAK'); fs.unlinkSync(f + '.bak');
    await panggil('get-couples');
    cek(fs.readdirSync(dataDir).some(n => n.includes('.corrupt-')), 'rusak tanpa cadangan: salinan file rusak disimpan');
    cek(!fs.readdirSync(dataDir).some(n => n.endsWith('.tmp')), 'tidak ada file sementara tertinggal');
  },

  async 'rekaman: dua rekaman tumpang tindih tidak tercampur'() {
    const { panggil, kirim, sesi } = nyalakanAplikasi();
    const A = await panggil('rec-start', 'pesan'); kirim('rec-chunk', A.id, Buffer.from('AAAA'));
    await tunggu(1100);
    const B = await panggil('rec-start', 'quiz'); kirim('rec-chunk', B.id, Buffer.from('BBBBBB'));
    kirim('rec-chunk', A.id, Buffer.from('AA'));                         // potongan terakhir A datang setelah B dimulai
    const rb = await panggil('rec-end', B.id, 7, {}), ra = await panggil('rec-end', A.id, 5, {});
    cek(fs.readFileSync(ra.file, 'utf8') === 'AAAAAA' && fs.readFileSync(rb.file, 'utf8') === 'BBBBBB', 'isi kedua file benar dan terpisah');
    cek(path.basename(path.dirname(ra.file)) === 'Rina & Dimas' && path.basename(ra.file).startsWith('Rina & Dimas_'), 'file masuk folder couple & diberi nama couple');
    const s = sesi();
    cek(s.length === 2 && new Set(s.map(x => x.id)).size === 2, 'dua sesi tercatat dengan ID unik');
    cek(s.every(x => x.status === 'webm'), 'status sesi benar (tanpa FFmpeg di uji)', s.map(x => x.status));
  },

  async 'rekaman: disk penuh tidak membuat aplikasi crash'() {
    const asli = fs.createWriteStream;
    fs.createWriteStream = () => new stream.Writable({ write(c, e, cb) { cb(new Error('ENOSPC: simulasi disk penuh')); } });
    const { panggil, kirim, sesi, electron } = nyalakanAplikasi();
    const r = await panggil('rec-start', 'pesan');
    kirim('rec-chunk', r.id, Buffer.alloc(70000, 1)); await tunggu(200);
    fs.createWriteStream = asli;
    cek(electron.__wc.terkirim.length === 0, 'belum ada jendela, jadi tidak ada pesan terkirim (tidak crash)');
    const e = await panggil('rec-end', r.id, 3, {});
    cek(e.ok === false && /ENOSPC/.test(e.error), 'rec-end melaporkan gagal');
    cek(sesi().at(-1).status === 'write-error', 'sesi ditandai gagal disimpan');
    const D = await panggil('rec-start', 'pesan'); await panggil('rec-abort', D.id);
    cek(!fs.existsSync(D.file) && sesi().length === 1, 'rekaman yang dibatalkan dihapus dari folder & daftar');
  },

  async 'pemulihan: tahap 1 (aplikasi mati saat merekam)'() {
    const { panggil, kirim, sesi } = nyalakanAplikasi({ akar: process.env.AKAR });
    const r = await panggil('rec-start', 'pesan');
    for (let i = 0; i < 5; i++) kirim('rec-chunk', r.id, Buffer.alloc(4000, i));
    await tunggu(800);
    cek(sesi()[0].status === 'recording', 'sesi tercatat sejak rekaman dimulai');
    process.exit(0);                                                     // mati mendadak, tanpa rec-end
  },
  async 'pemulihan: tahap 2 (aplikasi dibuka lagi)'() {
    const { panggil, sesi, electron } = nyalakanAplikasi({ akar: process.env.AKAR });
    electron.__siap(); await tunggu(300);
    const s = sesi()[0];
    cek(s.recovered === true && s.status === 'webm', 'rekaman terputus dipulihkan', s);
    cek((await panggil('get-startup-info')).recovered === 1, 'layar diberi tahu 1 rekaman dipulihkan');
    cek((await panggil('get-startup-info')).recovered === 0, 'pemberitahuan hanya sekali');
  },

  async 'foto: simpan 4 foto + hasil'() {
    const { panggil, docsDir, sesi } = nyalakanAplikasi();
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const r1 = await panggil('save-photos', { originals: [jpg, jpg, jpg, jpg], result: jpg, meta: { layout: 'grid' } });
    const r2 = await panggil('save-photos', { originals: [jpg], result: jpg, meta: {} });
    cek(r1.ok && r2.ok, 'dua sesi foto tersimpan (walau di detik yang sama)');
    const dir = path.join(docsDir, 'VideoboothRecordings', 'Rina & Dimas', 'Foto');
    const files = fs.readdirSync(dir);
    cek(files.filter(f => f.endsWith('_hasil.jpg')).length === 2 && files.filter(f => /_foto-\d\.jpg$/.test(f)).length === 5, 'file foto & hasil ada di <couple>/Foto', files);
    cek(sesi().every(x => x.label === 'foto' && x.status === 'photo'), 'sesi foto tercatat');
    cek((await panggil('save-photos', { originals: [], result: null })).error === 'Data foto kosong', 'data kosong ditolak');
  },

  async 'nama couple dengan karakter terlarang'() {
    const { panggil } = nyalakanAplikasi();
    const d = await panggil('save-couple', { name: 'Sinta / Rama: 2026?', questions: ['a'] });
    await panggil('set-active-couple', d.couple.id);
    const r = await panggil('rec-start', 'pesan');
    cek(path.basename(path.dirname(r.file)) === 'Sinta Rama 2026', 'karakter / : ? dibuang dari nama folder', r.file);
    await panggil('rec-abort', r.id);
  },

  async 'jendela: pengaman navigasi & menu (Mac)'() {
    const { electron } = nyalakanAplikasi({ platform: 'darwin' });
    electron.__siap(); await tunggu(200);
    const win = electron.__jendela;
    cek(win && /index\.html$/.test(win.dimuat) && /preload\.js$/.test(win.opsi.webPreferences.preload), 'jendela memuat index.html & preload.js dari folder proyek');
    const ev = { dicegah: false, preventDefault() { this.dicegah = true; } };
    electron.__wcEvents['will-navigate'](ev, 'file:///Users/x/Desktop/foto.jpg');
    cek(ev.dicegah, 'file yang terseret ke jendela tidak membuka halaman lain');
    const ok = { dicegah: false, preventDefault() { this.dicegah = true; } };
    electron.__wcEvents['will-navigate'](ok, require('url').pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    cek(!ok.dicegah, 'halaman aplikasi sendiri tetap boleh dimuat');
    cek(electron.__wc.openHandler().action === 'deny', 'jendela baru ditolak');
    cek(JSON.stringify(electron.__menu) === JSON.stringify([{ role: 'appMenu' }, { role: 'editMenu' }]), 'menu Mac tanpa Reload/DevTools', electron.__menu);
    electron.__appEvents['second-instance']();
    cek(win.difokuskan, 'klik ikon lagi memunculkan jendela yang ada');
  },
  async 'jendela: mode --dev menampilkan menu Developer'() {
    const { electron } = nyalakanAplikasi({ platform: 'darwin', argv: ['--dev'] });
    electron.__siap(); await tunggu(200);
    cek(electron.__menu.some(m => m.label === 'Developer'), 'menu Developer muncul dengan --dev');
  },
  async 'satu jendela: aplikasi kedua langsung keluar'() {
    process.on('exit', () => { cek(true, 'aplikasi kedua keluar sebelum membuka apa pun'); const h = hasil(); if (h.gagal) process.exitCode = 1; console.log('##HASIL ' + JSON.stringify(h)); });
    nyalakanAplikasi({ lock: false });
  },
};

// ---------- Penjalan ----------
async function jalankanSatu(nama) {
  await KASUS[nama]();
  console.log('##HASIL ' + JSON.stringify(hasil()));
  process.exit(hasil().gagal ? 1 : 0);
}
function jalankanSemua() {
  let lulus = 0, gagal = 0;
  const akarPulih = fs.mkdtempSync(path.join(require('os').tmpdir(), 'videobooth-pulih-'));
  for (const nama of Object.keys(KASUS)) {
    console.log('\n▶ ' + nama);
    const p = spawnSync(process.execPath, [__filename, nama], { encoding: 'utf8', env: { ...process.env, AKAR: akarPulih } });
    const out = (p.stdout || '') + (p.stderr || '');
    out.split('\n').filter(l => l.startsWith('  ') && !l.startsWith('##')).forEach(l => console.log(l));
    const m = out.match(/##HASIL (\{.*\})/);
    if (m) { const h = JSON.parse(m[1]); lulus += h.lulus; gagal += h.gagal; }
    else if (!nama.includes('tahap 1')) { gagal++; console.log('  ✗ kasus berhenti tanpa hasil:\n' + out.split('\n').slice(-15).join('\n')); }
    else { const n = (out.match(/  ✓/g) || []).length; lulus += n; gagal += (out.match(/  ✗/g) || []).length; }
  }
  console.log(`\n${gagal ? '✗' : '✓'} Uji proses utama: ${lulus} lulus, ${gagal} gagal`);
  process.exit(gagal ? 1 : 0);
}

const nama = process.argv[2];
if (nama && KASUS[nama]) jalankanSatu(nama); else jalankanSemua();
