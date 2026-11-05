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
    cek(/Quick quiz aktif/.test((await panggil('save-couple', { name: 'X', questions: ['', ' '] })).error), 'quiz aktif tanpa pertanyaan ditolak');
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

  async 'pengaturan videobooth & photobooth'() {
    const { panggil } = nyalakanAplikasi();
    const s = await panggil('get-settings');
    cek(s.pesanCountdown === 3 && s.pesanMaxSeconds === 0 && s.photoCountdown === 5 && s.photoPreview === 2, 'nilai bawaan angka benar', s);
    cek(s.enablePesan && s.enableQuiz && s.enablePhoto && s.photoFlash, 'semua menu & efek kilat aktif secara bawaan');
    let r = await panggil('save-settings', { pesanCountdown: 0, pesanMaxSeconds: 120, photoCountdown: 3, photoPreview: 0, photoFlash: false, enableQuiz: false });
    cek(r.pesanCountdown === 0 && r.pesanMaxSeconds === 120 && r.photoCountdown === 3 && r.photoPreview === 0 && !r.photoFlash && !r.enableQuiz, 'pengaturan baru tersimpan', r);
    r = await panggil('save-settings', { pesanCountdown: 99, pesanMaxSeconds: 9999, photoCountdown: 1, photoPreview: -2 });
    cek(r.pesanCountdown === 10 && r.pesanMaxSeconds === 600 && r.photoCountdown === 2 && r.photoPreview === 0, 'nilai di luar batas dibatasi', r);
    await panggil('save-settings', { enablePhoto: false });
    r = await panggil('save-settings', { enablePesan: false });
    cek(r.error && r.enablePesan === true, 'menu terakhir tidak bisa dimatikan', r);
    const c = await panggil('get-config');
    cek(c.pesanMaxSeconds === 600 && c.enableQuiz === false && c.photoFlash === false && c.loginId === undefined, 'get-config membawa pengaturan booth');
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

  async 'template desain foto per couple'() {
    const { panggil, dataDir } = nyalakanAplikasi();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
    cek((await panggil('list-templates', 'A')).length === 0, 'awalnya belum ada template');
    cek((await panggil('save-template', { nama: 'X' })).error === 'Couple belum dipilih.', 'template tanpa couple ditolak');
    const slots = [{ x: 60, y: 60, w: 500, h: 600 }, { x: 99999, y: 0, w: 5, h: 99999 }, {}, {}, { x: 1, y: 1, w: 1, h: 1 }];
    let r = await panggil('save-template', { coupleId: 'A', nama: 'Rustic', ukuran: 'strip', latarWarna: '#F3EDE4', slots,
      texts: [{ text: '{couple}', x: 300, y: 1700, size: 50, color: '#3A2E25', font: 'script' }] }, { latar: jpg, bingkai: png });
    cek(r.ok && r.template.W === 600 && r.template.H === 1800, 'template strip tersimpan dengan ukuran 600×1800', r.template && [r.template.W, r.template.H]);
    cek(r.template.slots.length === 4, 'posisi foto selalu tepat 4');
    const s2 = r.template.slots[1];
    cek(s2.w >= 40 && s2.h <= 1800 && s2.x <= 600, 'posisi foto di luar batas dirapikan', s2);
    cek(/^data:image\/jpeg;base64,/.test(r.template.latarUrl) && /^data:image\/png;base64,/.test(r.template.bingkaiUrl), 'gambar latar & bingkai tersimpan');
    cek((await panggil('save-template', { coupleId: 'A', nama: 'B' }, { bingkai: jpg })).error === 'Bingkai harus PNG supaya bagian fotonya bisa transparan.', 'bingkai JPG ditolak');
    cek((await panggil('save-template', { coupleId: 'A', nama: 'B' }, { latar: new Uint8Array([1, 2, 3]) })).error === 'Gambar harus berformat PNG atau JPG.', 'file bukan gambar ditolak');
    const id = r.template.id;
    r = await panggil('save-template', { ...r.template, nama: 'Rustic 2' }, { latar: null });
    cek(r.ok && !r.template.latarUrl && r.template.bingkaiUrl && r.template.nama === 'Rustic 2', 'edit: latar dihapus, bingkai tetap');
    await panggil('save-template', { coupleId: 'B', nama: 'Milik B' });
    const a = await panggil('list-templates', 'A');
    cek(a.length === 1 && a[0].id === id, 'template couple lain tidak ikut tampil', a.map(x => x.nama));
    cek((await panggil('delete-template', id)).ok && !fs.existsSync(path.join(dataDir, 'templates', id)), 'template bisa dihapus beserta gambarnya');
    fs.mkdirSync(path.join(dataDir, 'jangan-dihapus'));
    await panggil('delete-template', '../jangan-dihapus');
    cek(fs.existsSync(path.join(dataDir, 'jangan-dihapus')), 'folder di luar folder template tetap ada');
  },

  async 'menu per couple'() {
    const { panggil } = nyalakanAplikasi();
    await panggil('save-settings', { enableQuiz: false });          // pengaturan menu lama
    let d = await panggil('get-couples');
    cek(d.couples[0].menu.pesan && !d.couples[0].menu.quiz && d.couples[0].menu.photo, 'couple lama mengikuti pengaturan menu lama', d.couples[0].menu);
    let r = await panggil('save-couple', { name: 'A', questions: [], menu: { pesan: false, quiz: false, photo: false } });
    cek(/Minimal satu menu/.test(r.error), 'semua menu mati ditolak', r.error);
    r = await panggil('save-couple', { name: 'A', questions: [], menu: { pesan: false, quiz: true, photo: false } });
    cek(/Quick quiz aktif/.test(r.error), 'quiz aktif tanpa pertanyaan ditolak', r.error);
    r = await panggil('save-couple', { name: 'A', questions: [], menu: { pesan: false, quiz: false, photo: true } });
    cek(r.ok && r.couple.menu.photo && !r.couple.menu.pesan && !r.couple.menu.quiz, 'couple hanya Photo booth tanpa pertanyaan boleh', r.couple && r.couple.menu);
    r = await panggil('save-couple', { name: 'B', questions: ['q'], menu: { pesan: 'ya' } });
    cek(r.ok && r.couple.menu.pesan === true && r.couple.menu.quiz === false, 'nilai menu yang tidak jelas memakai bawaan', r.couple.menu);
  },

  async 'hapus couple ikut menghapus templatenya'() {
    const { panggil, dataDir } = nyalakanAplikasi();
    const c = (await panggil('save-couple', { name: 'Ayu & Budi', questions: ['a'] })).couple;
    const lain = (await panggil('get-couples')).couples[0];
    await panggil('save-template', { coupleId: c.id, nama: 'T1' });
    await panggil('save-template', { id: 'tplB', coupleId: c.id, nama: 'T2' });
    const punyaLain = (await panggil('save-template', { id: 'tplL', coupleId: lain.id, nama: 'Lain' })).template;
    const n = await panggil('count-templates');
    cek(n[c.id] === 2 && n[lain.id] === 1, 'jumlah template per couple dihitung', n);
    const r = await panggil('delete-couple', c.id);
    cek(r.ok && r.templateDihapus === 2, 'dua template couple ikut terhapus', r.templateDihapus);
    const sisa = fs.readdirSync(path.join(dataDir, 'templates'));
    cek(sisa.length === 1 && sisa[0] === punyaLain.id, 'template couple lain tetap ada', sisa);
    cek(/Belum ada rekaman/.test(await panggil('open-couple-folder', lain.id)), 'folder couple yang belum punya hasil tidak dibuat kosong');
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
  async 'kamera sony (simulasi): foto, rekam, salin video'() {
    const { panggil, electron, sesi, docsDir } = nyalakanAplikasi();
    electron.__siap(); await tunggu(200);
    cek((await panggil('sony-status')).mode === 'webcam', 'bawaan memakai webcam');
    const s = await panggil('save-settings', { kamera: 'sony-sim' });
    cek(s.kamera === 'sony-sim', 'sumber kamera tersimpan');
    cek((await panggil('save-settings', { kamera: 'kamera-aneh' })).kamera === 'sony-sim', 'nilai sumber kamera yang tidak dikenal diabaikan');
    await tunggu(700);
    const st = await panggil('sony-status');
    cek(st.tersambung && /ILCE-6700/.test(st.model) && st.baterai === 100, 'kamera simulasi tersambung', st);
    cek(electron.__jendela.webContents.terkirim.some(([n, x]) => n === 'sony-status' && x.tersambung), 'layar diberi kabar status kamera');
    const lv = await panggil('sony-lv');
    cek(Buffer.isBuffer(lv) && lv[0] === 0xff && lv[1] === 0xd8, 'live view berupa gambar JPEG');
    const f = await panggil('sony-foto');
    cek(f.ok && f.bytes.length > 50000 && f.bytes[0] === 0xff, 'jepret: foto resolusi penuh masuk', f.bytes && f.bytes.length);
    const r = await panggil('rec-start', 'pesan', { sony: true });
    cek(r.id && /_pesan\.mp4$/.test(r.file), 'rekam Sony langsung bernama .mp4', r.file);
    cek(sesi()[0].status === 'recording' && sesi()[0].kamera === 'sony', 'sesi tercatat sebagai rekaman kamera Sony');
    cek((await panggil('sony-status')).merekam === true, 'status kamera: sedang merekam');
    await tunggu(300);
    const e = await panggil('rec-end', r.id, 12, { couple: 'Rina & Dimas' });
    cek(e.ok && sesi()[0].status === 'transfer' && /^C\d+\.MP4$/.test(sesi()[0].kartu), 'berhenti rekam: video disalin dari kartu di belakang', sesi()[0]);
    await tunggu(1500);
    cek(sesi()[0].status === 'done' && fs.statSync(r.file).size > 10000, 'video tersalin ke folder couple', sesi()[0]);
    cek(path.dirname(r.file) === path.join(docsDir, 'VideoboothRecordings', 'Rina & Dimas'), 'video ada di folder couple');
    // dua rekaman berurutan: penyalinan antre, keduanya selesai
    const a = await panggil('rec-start', 'quiz-1', { sony: true }); await panggil('rec-end', a.id, 5, {});
    const b = await panggil('rec-start', 'quiz-2', { sony: true }); await panggil('rec-end', b.id, 5, {});
    await tunggu(3000);
    cek(sesi().filter(x => x.status === 'done').length === 3 && fs.existsSync(a.file) && fs.existsSync(b.file), 'dua rekaman beruntun ikut tersalin');
    await panggil('save-settings', { kamera: 'webcam' });
    cek((await panggil('sony-status')).mode === 'webcam' && (await panggil('sony-lv')) === null, 'kembali ke webcam: kamera Sony dilepas');
  },

  async 'bahasa tamu'() {
    const { panggil } = nyalakanAplikasi();
    cek((await panggil('get-settings')).bahasa === 'id', 'bawaan bahasa Indonesia');
    cek((await panggil('save-settings', { bahasa: 'en' })).bahasa === 'en', 'bahasa tamu bisa diganti ke English');
    cek((await panggil('save-settings', { bahasa: 'fr' })).bahasa === 'en', 'bahasa yang tidak dikenal diabaikan');
    cek((await panggil('get-config')).bahasa === 'en', 'bahasa ikut terkirim ke layar saat aplikasi dibuka');
  },

  async 'riwayat sesi: buka, Finder, coba lagi'() {
    const { panggil, electron, sesi, dataDir } = nyalakanAplikasi();
    electron.__siap(); await tunggu(200);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    await panggil('save-photos', { originals: [jpg], result: jpg, meta: {} });
    const foto = sesi()[0];
    cek((await panggil('session-open', foto.id)).ok && /_hasil\.jpg$/.test(electron.__dibuka), 'foto hasil bisa dibuka');
    cek((await panggil('session-reveal', foto.id)).ok && /_hasil\.jpg$/.test(electron.__ditunjukkan), 'foto ditunjukkan di Finder');
    cek(/^data:image\/jpeg;base64,/.test(await panggil('session-thumb', foto.id)), 'gambar kecil foto tersedia');
    cek((await panggil('session-open', 12345)).error, 'sesi tidak dikenal ditolak dengan pesan');
    cek(/tidak perlu diulang/.test((await panggil('session-retry', foto.id)).error), 'sesi yang sudah beres tidak bisa diulang');
    // Video Sony yang tertinggal di kartu: salin lagi
    await panggil('save-settings', { kamera: 'sony-sim' }); await tunggu(700);
    const r = await panggil('rec-start', 'pesan', { sony: true });
    await panggil('rec-end', r.id, 5, {}); await tunggu(1500);
    const list = sesi(); const v = list.find(x => x.id !== foto.id);
    cek(v.status === 'done' && v.kartuInfo && v.kartuInfo.contentId, 'info file di kartu SD dicatat untuk salin ulang', v);
    fs.unlinkSync(r.file);
    list.find(x => x.id === v.id).status = 'card-only';
    fs.writeFileSync(path.join(dataDir, 'sessions.json'), JSON.stringify(list));
    const u = await panggil('session-retry', v.id);
    cek(u.ok && sesi().find(x => x.id === v.id).status === 'transfer', 'Coba salin lagi: status jadi Menyalin', u);
    await tunggu(1500);
    cek(sesi().find(x => x.id === v.id).status === 'done' && fs.existsSync(r.file), 'video tersalin ulang ke folder couple');
    await panggil('save-settings', { kamera: 'webcam' });
  },

  async 'kamera sony: program penghubung belum dibuat'() {
    process.env.SONY_HELPER = path.join(require('os').tmpdir(), 'tidak-ada', 'sony-helper');
    const { panggil, electron, dataDir } = nyalakanAplikasi();
    electron.__siap(); await tunggu(100);
    const st = await panggil('save-settings', { kamera: 'sony' }) && await panggil('sony-status');
    cek(!st.tersambung && /npm run build:sony/.test(st.pesan), 'pesan jelas cara membuat program kamera', st.pesan);
    const f = await panggil('sony-foto');
    cek(/npm run build:sony/.test(f.error), 'jepret ditolak dengan pesan yang sama');
    const r = await panggil('rec-start', 'pesan', { sony: true });
    const fileSesi = path.join(dataDir, 'sessions.json');
    cek(r.error && (!fs.existsSync(fileSesi) || JSON.parse(fs.readFileSync(fileSesi, 'utf8')).length === 0), 'rekam Sony ditolak, tidak ada sesi kosong', r);
  },

  async 'kamera sony: program penghubung asli (SDK palsu)'() {
    const bin = path.join(__dirname, '..', 'kamera-sony', 'uji', 'bin', 'sony-helper-palsu');
    if (!fs.existsSync(bin)) { cek(true, 'dilewati: program uji belum dibuat (hanya di komputer pengembang)'); return; }
    process.env.SONY_HELPER = bin;
    const { panggil, electron, sesi } = nyalakanAplikasi();
    electron.__siap(); await tunggu(100);
    await panggil('save-settings', { kamera: 'sony' });
    await tunggu(1500);
    const st = await panggil('sony-status');
    cek(st.tersambung && st.model === 'ILCE-6700' && st.baterai === 87, 'program penghubung tersambung lewat SDK', st);
    const lv = await panggil('sony-lv');
    cek(lv && lv[0] === 0xff && lv[1] === 0xd8, 'live view dari SDK terbaca');
    const f = await panggil('sony-foto');
    cek(f.ok && f.bytes[0] === 0xff, 'jepret lewat SDK berhasil', f.error);
    const r = await panggil('rec-start', 'pesan', { sony: true });
    await tunggu(500);
    const e = await panggil('rec-end', r.id, 3, {});
    cek(e.ok, 'rekam lewat SDK berhenti & file barunya ditemukan', e.error);
    await tunggu(1500);
    cek(sesi()[0].status === 'done' && fs.readFileSync(r.file, 'utf8').startsWith('video palsu'), 'video tersalin dari "kartu" ke folder couple', sesi()[0]);
    await panggil('save-settings', { kamera: 'webcam' });
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
