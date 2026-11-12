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
    const d = await panggil('get-couples');
    cek(d.couples.length === 1 && d.couples[0].id === d.activeId, 'couple pertama dibuat dari config.json dan aktif');
    cek(
      (await panggil('save-couple', { name: '  ', questions: ['a'] })).error === "Please enter the couple's name.",
      'nama kosong ditolak',
    );
    cek(
      /Quick quiz is on/.test((await panggil('save-couple', { name: 'X', questions: ['', ' '] })).error),
      'quiz aktif tanpa pertanyaan ditolak',
    );
    let r = await panggil('save-couple', {
      name: 'Ayu & Budi',
      questions: Array.from({ length: 12 }, (_, i) => 'Q' + i),
    });
    cek(r.couple.questions.length === 10, 'pertanyaan dibatasi 10');
    cek(r.data.activeId !== r.couple.id, 'couple baru tidak otomatis aktif');
    r = await panggil('set-active-couple', r.couple.id);
    cek(r.ok, 'couple aktif bisa diganti');
    r = await panggil('save-couple', { ...r.data.couples[1], name: 'Ayu & Budi (edit)' });
    cek(r.data.couples.length === 2 && r.couple.name === 'Ayu & Budi (edit)', 'edit tidak menambah couple baru');
    r = await panggil('delete-couple', r.data.activeId);
    cek(
      r.ok && r.data.couples.length === 1 && r.data.activeId === r.data.couples[0].id,
      'hapus couple aktif memindahkan status aktif',
    );
    cek(
      (await panggil('delete-couple', r.data.activeId)).error === 'There must be at least 1 couple.',
      'couple terakhir tidak bisa dihapus',
    );
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
    cek(
      c.quizSeconds === 300 && c.colors.accent === '#7C9A7E' && c.login === undefined,
      'get-config ikut berubah dan tidak membocorkan login',
    );
    cek(
      (await panggil('change-login', '0000', 'bos', 'rahasia')).error === 'Current password is wrong.',
      'ganti login: password lama salah ditolak',
    );
    cek(
      (await panggil('change-login', '1234', 'bos', '12')).error === 'The new password needs at least 4 characters.',
      'ganti login: password pendek ditolak',
    );
    cek((await panggil('change-login', '1234', 'bos', 'rahasia')).ok, 'ganti login berhasil');
    cek(
      !(await panggil('login', 'leura', '1234')) && (await panggil('login', 'BOS', 'rahasia')),
      'login lama tidak berlaku, login baru berlaku',
    );
    cek(
      !fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8').includes('rahasia'),
      'password tidak tersimpan sebagai teks biasa',
    );
  },

  async 'pengaturan videobooth & photobooth'() {
    const { panggil } = nyalakanAplikasi();
    const s = await panggil('get-settings');
    cek(
      s.messageCountdown === 3 && s.messageMaxSeconds === 0 && s.photoCountdown === 5 && s.photoPreview === 2,
      'nilai bawaan angka benar',
      s,
    );
    cek(
      s.enableMessage && s.enableQuiz && s.enablePhoto && s.photoFlash,
      'semua menu & efek kilat aktif secara bawaan',
    );
    let r = await panggil('save-settings', {
      messageCountdown: 0,
      messageMaxSeconds: 120,
      photoCountdown: 3,
      photoPreview: 0,
      photoFlash: false,
      enableQuiz: false,
    });
    cek(
      r.messageCountdown === 0 &&
        r.messageMaxSeconds === 120 &&
        r.photoCountdown === 3 &&
        r.photoPreview === 0 &&
        !r.photoFlash &&
        !r.enableQuiz,
      'pengaturan baru tersimpan',
      r,
    );
    r = await panggil('save-settings', {
      messageCountdown: 99,
      messageMaxSeconds: 9999,
      photoCountdown: 1,
      photoPreview: -2,
    });
    cek(
      r.messageCountdown === 10 && r.messageMaxSeconds === 600 && r.photoCountdown === 2 && r.photoPreview === 0,
      'nilai di luar batas dibatasi',
      r,
    );
    await panggil('save-settings', { enablePhoto: false });
    r = await panggil('save-settings', { enableMessage: false });
    cek(r.error && r.enableMessage === true, 'menu terakhir tidak bisa dimatikan', r);
    const c = await panggil('get-config');
    cek(
      c.messageMaxSeconds === 600 && c.enableQuiz === false && c.photoFlash === false && c.loginId === undefined,
      'get-config membawa pengaturan booth',
    );
  },

  async 'file data rusak tidak menghapus data'() {
    const { panggil, dataDir } = nyalakanAplikasi();
    await panggil('save-couple', { name: 'Ayu & Budi', questions: ['a'] });
    await panggil('save-couple', { name: 'Citra & Doni', questions: ['b'] });
    const f = path.join(dataDir, 'couples.json');
    fs.writeFileSync(f, '{"activeId":"c1","coup'); // simulasi listrik mati saat menulis
    const d = await panggil('get-couples');
    cek(
      d.couples.some(c => c.name === 'Ayu & Budi'),
      'file rusak: data dibaca dari cadangan .bak',
    );
    fs.writeFileSync(f, 'RUSAK');
    fs.unlinkSync(f + '.bak');
    await panggil('get-couples');
    cek(
      fs.readdirSync(dataDir).some(n => n.includes('.corrupt-')),
      'rusak tanpa cadangan: salinan file rusak disimpan',
    );
    cek(!fs.readdirSync(dataDir).some(n => n.endsWith('.tmp')), 'tidak ada file sementara tertinggal');
  },

  async 'rekaman: dua rekaman tumpang tindih tidak tercampur'() {
    const { panggil, kirim, sesi } = nyalakanAplikasi();
    const A = await panggil('rec-start', 'message');
    kirim('rec-chunk', A.id, Buffer.from('AAAA'));
    await tunggu(1100);
    const B = await panggil('rec-start', 'quiz');
    kirim('rec-chunk', B.id, Buffer.from('BBBBBB'));
    kirim('rec-chunk', A.id, Buffer.from('AA')); // potongan terakhir A datang setelah B dimulai
    const rb = await panggil('rec-end', B.id, 7, {}),
      ra = await panggil('rec-end', A.id, 5, {});
    cek(
      fs.readFileSync(ra.file, 'utf8') === 'AAAAAA' && fs.readFileSync(rb.file, 'utf8') === 'BBBBBB',
      'isi kedua file benar dan terpisah',
    );
    cek(
      path.basename(path.dirname(ra.file)) === 'Rina & Dimas' && path.basename(ra.file).startsWith('Rina & Dimas_'),
      'file masuk folder couple & diberi nama couple',
    );
    const s = sesi();
    cek(s.length === 2 && new Set(s.map(x => x.id)).size === 2, 'dua sesi tercatat dengan ID unik');
    cek(
      s.every(x => x.status === 'webm'),
      'status sesi benar (tanpa FFmpeg di uji)',
      s.map(x => x.status),
    );
  },

  async 'rekaman: disk penuh tidak membuat aplikasi crash'() {
    const asli = fs.createWriteStream;
    fs.createWriteStream = () =>
      new stream.Writable({
        write(c, e, cb) {
          cb(new Error('ENOSPC: simulasi disk penuh'));
        },
      });
    const { panggil, kirim, sesi, electron } = nyalakanAplikasi();
    const r = await panggil('rec-start', 'message');
    kirim('rec-chunk', r.id, Buffer.alloc(70000, 1));
    await tunggu(200);
    fs.createWriteStream = asli;
    cek(electron.__wc.sent.length === 0, 'belum ada jendela, jadi tidak ada pesan terkirim (tidak crash)');
    const e = await panggil('rec-end', r.id, 3, {});
    cek(e.ok === false && /ENOSPC/.test(e.error), 'rec-end melaporkan gagal');
    cek(sesi().at(-1).status === 'write-error', 'sesi ditandai gagal disimpan');
    const D = await panggil('rec-start', 'message');
    await panggil('rec-abort', D.id);
    cek(!fs.existsSync(D.file) && sesi().length === 1, 'rekaman yang dibatalkan dihapus dari folder & daftar');
  },

  async 'pemulihan: tahap 1 (aplikasi mati saat merekam)'() {
    const { panggil, kirim, sesi } = nyalakanAplikasi({ akar: process.env.AKAR });
    const r = await panggil('rec-start', 'message');
    for (let i = 0; i < 5; i++) kirim('rec-chunk', r.id, Buffer.alloc(4000, i));
    await tunggu(800);
    cek(sesi()[0].status === 'recording', 'sesi tercatat sejak rekaman dimulai');
    process.exit(0); // mati mendadak, tanpa rec-end
  },
  async 'pemulihan: tahap 2 (aplikasi dibuka lagi)'() {
    const { panggil, sesi, electron } = nyalakanAplikasi({ akar: process.env.AKAR });
    electron.__siap();
    await tunggu(300);
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
    cek(
      files.filter(f => f.endsWith('_hasil.jpg')).length === 2 &&
        files.filter(f => /_foto-\d\.jpg$/.test(f)).length === 5,
      'file foto & hasil ada di <couple>/Foto',
      files,
    );
    cek(
      sesi().every(x => x.label === 'photo' && x.status === 'photo'),
      'sesi foto tercatat',
    );
    cek(
      (await panggil('save-photos', { originals: [], result: null })).error === 'No photo data',
      'data kosong ditolak',
    );
  },

  async 'nama tamu jadi nama file (video & foto)'() {
    const { panggil, kirim, docsDir, sesi } = nyalakanAplikasi();
    const dirCouple = path.join(docsDir, 'VideoboothRecordings', 'Rina & Dimas');
    const A = await panggil('rec-start', 'message', { guest: '  Budi Ari ' });
    kirim('rec-chunk', A.id, Buffer.from('AA'));
    const ra = await panggil('rec-end', A.id, 4, {});
    cek(
      path.basename(ra.file) === 'Budi Ari_pesan.webm' && path.dirname(ra.file) === dirCouple,
      'video pesan: <couple>/Budi Ari_pesan',
      ra.file,
    );
    // Seolah sudah diubah ke MP4 (file .webm hilang, .mp4 ada): nama yang sama tidak boleh dipakai lagi
    fs.renameSync(ra.file, ra.file.replace(/\.webm$/, '.mp4'));
    const B = await panggil('rec-start', 'message', { guest: 'Budi Ari' });
    await panggil('rec-end', B.id, 3, {});
    cek(
      path.basename(B.file || sesi().at(-1).file).startsWith('Budi Ari_2_pesan'),
      'tamu bernama sama: Budi Ari_2_pesan (tidak menimpa)',
      sesi().at(-1).file,
    );
    const C = await panggil('rec-start', 'quiz', { guest: 'Budi Ari' });
    await panggil('rec-end', C.id, 3, {});
    cek(sesi().at(-1).file === 'Budi Ari_quiz.webm', 'tamu yang sama ikut quiz: Budi Ari_quiz', sesi().at(-1).file);
    cek(sesi().filter(x => x.guest === 'Budi Ari').length === 3, 'nama tamu tercatat di riwayat sesi');
    const D = await panggil('rec-start', 'message', { guest: 'Ani/Bu:di?' });
    await panggil('rec-end', D.id, 3, {});
    cek(sesi().at(-1).file === 'AniBudi_pesan.webm', 'karakter terlarang di nama file dibuang', sesi().at(-1).file);
    const E = await panggil('rec-start', 'message', { guest: '' });
    await panggil('rec-end', E.id, 3, {});
    cek(
      /^Rina & Dimas_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d_pesan\.webm$/.test(sesi().at(-1).file),
      'tanpa nama tamu: nama lama (couple + waktu)',
      sesi().at(-1).file,
    );
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    await panggil('save-photos', { originals: [jpg, jpg], result: jpg, meta: {}, guest: 'Sari' });
    await panggil('save-photos', { originals: [jpg], result: jpg, meta: {}, guest: 'Sari' });
    const foto = fs.readdirSync(path.join(dirCouple, 'Foto')).sort();
    cek(
      JSON.stringify(foto) ===
        JSON.stringify([
          'Sari_2_foto-1.jpg',
          'Sari_2_hasil.jpg',
          'Sari_foto-1.jpg',
          'Sari_foto-2.jpg',
          'Sari_hasil.jpg',
        ]),
      'foto: Sari_hasil.jpg + Sari_foto-1…, berikutnya Sari_2_…',
      foto,
    );
    cek(sesi().at(-1).guest === 'Sari' && sesi().at(-1).file === 'Sari_2_hasil.jpg', 'sesi foto mencatat nama tamu');
  },

  async 'catatan harian (log) untuk melacak masalah'() {
    const { electron, panggil, kirim, dataDir, akar } = nyalakanAplikasi();
    const folder = path.join(dataDir, 'logs');
    // catatan lama (40 hari lalu) harus dihapus saat aplikasi dibuka
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, '2020-01-01.txt'), 'lama\n');
    electron.__siap();
    await tunggu(300);
    const hariIni = fs.readdirSync(folder).find(f => f !== '2020-01-01.txt');
    cek(!fs.existsSync(path.join(folder, '2020-01-01.txt')), 'catatan lebih dari 30 hari dihapus otomatis');
    const isi = () => fs.readFileSync(path.join(folder, hariIni), 'utf8');
    cek(
      /^\d{4}-\d\d-\d\d\.txt$/.test(hariIni) && /App opened/.test(isi()) && /Leura version 1\.0\.0/.test(isi()),
      'satu file per hari, dimulai "App opened" + versi',
      hariIni,
    );
    const A = await panggil('rec-start', 'message', { guest: 'Budi' });
    kirim('rec-chunk', A.id, Buffer.from('AA'));
    await panggil('rec-end', A.id, 5, {});
    cek(
      /\d\d:\d\d:\d\d +Recording started: message → Budi_pesan\.webm/.test(isi()) &&
        /Recording done \(5 s\): Budi_pesan\.webm/.test(isi()),
      'rekaman mulai & selesai tercatat dengan jam',
    );
    await panggil('login', 'leura', 'salah');
    cek(/⚠ Admin login failed/.test(isi()), 'login Admin gagal tercatat sebagai peringatan');
    console.error('uji error proses utama');
    cek(/✗ uji error proses utama/.test(isi()), 'console.error di proses utama masuk catatan (✗)');
    electron.__wcEvents['console-message'] &&
      electron.__wcEvents['console-message'](
        {},
        3,
        'Uncaught TypeError: x is undefined',
        12,
        'file:///app/src/photobooth.js',
      );
    cek(
      /✗ \[ui\] Uncaught TypeError: x is undefined \(photobooth\.js:12\)/.test(isi()),
      'error di tampilan masuk catatan beserta file & baris',
    );
    kirim('log', 'baris\ndua', 'peringatan');
    cek(/⚠ \[ui\] baris ⏎ dua/.test(isi()), 'baris dari tampilan: satu baris per kejadian');
    await panggil('save-upload-settings', { url: 'http://127.0.0.1:9', key: 'RAHASIA-KUNCI-123', enabled: true });
    cek(
      /QR settings saved: on/.test(isi()) && !/RAHASIA-KUNCI-123/.test(isi()),
      'kunci booth QR tidak pernah ditulis ke catatan',
    );
    const baca = await panggil('read-log');
    cek(
      baca.file === hariIni.replace('.txt', '') && /Recording done/.test(baca.text),
      'Admin "Lihat catatan": isi catatan hari ini',
    );
    electron.__simpanKe = path.join(akar, 'kirim.txt');
    const simpan = await panggil('save-log');
    const kirimIsi = fs.readFileSync(electron.__simpanKe, 'utf8');
    cek(
      simpan.ok &&
        /Leura app log/.test(kirimIsi) &&
        /===== \d{4}-\d\d-\d\d =====/.test(kirimIsi) &&
        /Recording done/.test(kirimIsi) &&
        electron.__ditunjukkan === electron.__simpanKe,
      'Admin "Simpan catatan": file gabungan tersimpan & ditunjukkan di Finder',
    );
    electron.__simpanKe = null;
    cek((await panggil('save-log')).canceled === true, 'Simpan catatan dibatalkan: tidak ada yang ditulis');
  },

  async 'template desain foto per couple'() {
    const { panggil, dataDir } = nyalakanAplikasi();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
    cek((await panggil('list-templates', 'A')).length === 0, 'awalnya belum ada template');
    cek(
      (await panggil('save-template', { name: 'X' })).error === 'No couple selected.',
      'template tanpa couple ditolak',
    );
    const slots = [
      { x: 60, y: 60, w: 500, h: 600 },
      { x: 99999, y: 0, w: 5, h: 99999 },
      {},
      {},
      { x: 1, y: 1, w: 1, h: 1 },
    ];
    let r = await panggil(
      'save-template',
      {
        coupleId: 'A',
        name: 'Rustic',
        size: 'strip',
        backgroundColor: '#F3EDE4',
        slots,
        texts: [{ text: '{couple}', x: 300, y: 1700, size: 50, color: '#3A2E25', font: 'script' }],
      },
      { background: jpg, frame: png },
    );
    cek(
      r.ok && r.template.W === 600 && r.template.H === 1800,
      'template strip tersimpan dengan ukuran 600×1800',
      r.template && [r.template.W, r.template.H],
    );
    cek(r.template.slots.length === 4, 'posisi foto selalu tepat 4');
    const s2 = r.template.slots[1];
    cek(s2.w >= 40 && s2.h <= 1800 && s2.x <= 600, 'posisi foto di luar batas dirapikan', s2);
    cek(
      /^data:image\/jpeg;base64,/.test(r.template.backgroundUrl) &&
        /^data:image\/png;base64,/.test(r.template.frameUrl),
      'gambar latar & bingkai tersimpan',
    );
    cek(
      (await panggil('save-template', { coupleId: 'A', name: 'B' }, { frame: jpg })).error ===
        'The frame must be a PNG so the photo areas can be transparent.',
      'bingkai JPG ditolak',
    );
    cek(
      (await panggil('save-template', { coupleId: 'A', name: 'B' }, { background: new Uint8Array([1, 2, 3]) }))
        .error === 'The image must be a PNG or JPG.',
      'file bukan gambar ditolak',
    );
    const id = r.template.id;
    r = await panggil('save-template', { ...r.template, name: 'Rustic 2' }, { background: null });
    cek(
      r.ok && !r.template.backgroundUrl && r.template.frameUrl && r.template.name === 'Rustic 2',
      'edit: latar dihapus, bingkai tetap',
    );
    await panggil('save-template', { coupleId: 'B', name: 'Milik B' });
    const a = await panggil('list-templates', 'A');
    cek(
      a.length === 1 && a[0].id === id,
      'template couple lain tidak ikut tampil',
      a.map(x => x.name),
    );
    cek(
      (await panggil('delete-template', id)).ok && !fs.existsSync(path.join(dataDir, 'templates', id)),
      'template bisa dihapus beserta gambarnya',
    );
    fs.mkdirSync(path.join(dataDir, 'jangan-dihapus'));
    await panggil('delete-template', '../jangan-dihapus');
    cek(fs.existsSync(path.join(dataDir, 'jangan-dihapus')), 'folder di luar folder template tetap ada');
  },

  async 'filter foto (LUT .cube) untuk template'() {
    const { panggil, dataDir } = nyalakanAplikasi();
    const kubus = (fn, n = 2) => {
      let t = 'TITLE "Hangat"\nLUT_3D_SIZE ' + n + '\n';
      for (let b = 0; b < n; b++)
        for (let g = 0; g < n; g++)
          for (let r = 0; r < n; r++) t += fn(r / (n - 1), g / (n - 1), b / (n - 1)).join(' ') + '\n';
      return new TextEncoder().encode(t);
    };
    cek((await panggil('list-filters')).length === 0, 'awalnya belum ada filter');
    const r = await panggil(
      'add-filter',
      'Hangat Sore.cube',
      kubus((r, g, b) => [Math.min(1, r * 1.1), g, b * 0.9], 3),
    );
    cek(
      r.ok && r.filter.name === 'Hangat Sore' && r.filter.size === 3,
      'file .cube valid ditambahkan (nama dari file, tanpa .cube)',
      r,
    );
    const id = r.filter.id;
    cek(fs.existsSync(path.join(dataDir, 'filter', id + '.cube')), 'file .cube asli tersimpan di folder data/filter');
    cek(
      /not a \.cube LUT file/.test((await panggil('add-filter', 'foto.cube', new TextEncoder().encode('halo'))).error),
      'file yang bukan .cube ditolak',
    );
    cek(
      /1D LUT/.test((await panggil('add-filter', 'x.cube', new TextEncoder().encode('LUT_1D_SIZE 4\n0 0 0'))).error),
      'LUT 1D ditolak dengan pesan jelas',
    );
    cek(
      /Missing color data/.test(
        (await panggil('add-filter', 'x.cube', new TextEncoder().encode('LUT_3D_SIZE 2\n0 0 0\n1 1 1'))).error,
      ),
      'data warna yang tidak lengkap ditolak',
    );
    cek(
      (await panggil('add-filter', 'x.cube', new Uint8Array(21 * 1024 * 1024))).error ===
        'The filter file is too large (max 20 MB).',
      'file lebih dari 20 MB ditolak',
    );
    const isi = await panggil('get-filter', id);
    cek(
      isi && /LUT_3D_SIZE 3/.test(isi.text) && isi.name === 'Hangat Sore',
      'isi filter bisa diambil untuk diterapkan ke foto',
    );
    cek((await panggil('get-filter', '../settings')) === null, 'nama filter aneh tidak bisa membaca file lain');
    cek(
      (await panggil('rename-filter', id, 'Sore Emas')).ok && (await panggil('list-filters'))[0].name === 'Sore Emas',
      'nama filter bisa diganti',
    );
    // Template menyimpan filter pilihan
    let t = await panggil('save-template', {
      coupleId: 'A',
      name: 'Hangat',
      filter: id,
      filterStrength: 250,
      guestPicksFilter: false,
    });
    cek(
      t.ok && t.template.filter === id && t.template.filterStrength === 100 && t.template.guestPicksFilter === false,
      'template menyimpan filter, kekuatan dibatasi 0–100%, kunci filter tamu',
      t.template,
    );
    t = await panggil('save-template', { coupleId: 'A', name: 'Polos', filter: '../../x' });
    cek(
      t.template.filter === 'x' && t.template.guestPicksFilter === true && t.template.filterStrength === 100,
      'id filter dibersihkan; bawaan: kekuatan 100%, tamu boleh memilih',
    );
    cek(
      (await panggil('delete-filter', id)).ok &&
        !fs.existsSync(path.join(dataDir, 'filter', id + '.cube')) &&
        (await panggil('list-filters')).length === 0,
      'filter bisa dihapus dari koleksi',
    );
    cek(
      (await panggil('get-filter', id)) === null,
      'filter yang sudah dihapus tidak bisa diambil (template kembali tanpa filter)',
    );
  },

  async 'menu per couple'() {
    const { panggil } = nyalakanAplikasi();
    await panggil('save-settings', { enableQuiz: false }); // pengaturan menu lama
    const d = await panggil('get-couples');
    cek(
      d.couples[0].menu.message && !d.couples[0].menu.quiz && d.couples[0].menu.photo,
      'couple lama mengikuti pengaturan menu lama',
      d.couples[0].menu,
    );
    let r = await panggil('save-couple', {
      name: 'A',
      questions: [],
      menu: { message: false, quiz: false, photo: false },
    });
    cek(/At least one option/.test(r.error), 'semua menu mati ditolak', r.error);
    r = await panggil('save-couple', { name: 'A', questions: [], menu: { message: false, quiz: true, photo: false } });
    cek(/Quick quiz is on/.test(r.error), 'quiz aktif tanpa pertanyaan ditolak', r.error);
    r = await panggil('save-couple', { name: 'A', questions: [], menu: { message: false, quiz: false, photo: true } });
    cek(
      r.ok && r.couple.menu.photo && !r.couple.menu.message && !r.couple.menu.quiz,
      'couple hanya Photo booth tanpa pertanyaan boleh',
      r.couple && r.couple.menu,
    );
    r = await panggil('save-couple', { name: 'B', questions: ['q'], menu: { message: 'ya' } });
    cek(
      r.ok && r.couple.menu.message === true && r.couple.menu.quiz === false,
      'nilai menu yang tidak jelas memakai bawaan',
      r.couple.menu,
    );
  },

  async 'hapus couple ikut menghapus templatenya'() {
    const { panggil, dataDir } = nyalakanAplikasi();
    const c = (await panggil('save-couple', { name: 'Ayu & Budi', questions: ['a'] })).couple;
    const lain = (await panggil('get-couples')).couples[0];
    await panggil('save-template', { coupleId: c.id, name: 'T1' });
    await panggil('save-template', { id: 'tplB', coupleId: c.id, name: 'T2' });
    const punyaLain = (await panggil('save-template', { id: 'tplL', coupleId: lain.id, name: 'Lain' })).template;
    const n = await panggil('count-templates');
    cek(n[c.id] === 2 && n[lain.id] === 1, 'jumlah template per couple dihitung', n);
    const r = await panggil('delete-couple', c.id);
    cek(r.ok && r.templatesDeleted === 2, 'dua template couple ikut terhapus', r.templatesDeleted);
    const sisa = fs.readdirSync(path.join(dataDir, 'templates'));
    cek(sisa.length === 1 && sisa[0] === punyaLain.id, 'template couple lain tetap ada', sisa);
    cek(
      /No recordings or photos/.test(await panggil('open-couple-folder', lain.id)),
      'folder couple yang belum punya hasil tidak dibuat kosong',
    );
  },

  async 'nama couple dengan karakter terlarang'() {
    const { panggil } = nyalakanAplikasi();
    const d = await panggil('save-couple', { name: 'Sinta / Rama: 2026?', questions: ['a'] });
    await panggil('set-active-couple', d.couple.id);
    const r = await panggil('rec-start', 'message');
    cek(path.basename(path.dirname(r.file)) === 'Sinta Rama 2026', 'karakter / : ? dibuang dari nama folder', r.file);
    await panggil('rec-abort', r.id);
  },

  async 'jendela: pengaman navigasi & menu (Mac)'() {
    const { electron } = nyalakanAplikasi({ platform: 'darwin' });
    electron.__siap();
    await tunggu(200);
    const win = electron.__jendela;
    cek(
      win && /index\.html$/.test(win.dimuat) && /preload\.js$/.test(win.opsi.webPreferences.preload),
      'jendela memuat index.html & preload.js dari folder proyek',
    );
    const ev = {
      dicegah: false,
      preventDefault() {
        this.dicegah = true;
      },
    };
    electron.__wcEvents['will-navigate'](ev, 'file:///Users/x/Desktop/foto.jpg');
    cek(ev.dicegah, 'file yang terseret ke jendela tidak membuka halaman lain');
    const ok = {
      dicegah: false,
      preventDefault() {
        this.dicegah = true;
      },
    };
    electron.__wcEvents['will-navigate'](
      ok,
      require('url').pathToFileURL(path.join(__dirname, '..', 'index.html')).href,
    );
    cek(!ok.dicegah, 'halaman aplikasi sendiri tetap boleh dimuat');
    cek(electron.__wc.openHandler().action === 'deny', 'jendela baru ditolak');
    cek(
      JSON.stringify(electron.__menu) === JSON.stringify([{ role: 'appMenu' }, { role: 'editMenu' }]),
      'menu Mac tanpa Reload/DevTools',
      electron.__menu,
    );
    electron.__appEvents['second-instance']();
    cek(win.difokuskan, 'klik ikon lagi memunculkan jendela yang ada');
  },
  async 'jendela: mode --dev menampilkan menu Developer'() {
    const { electron } = nyalakanAplikasi({ platform: 'darwin', argv: ['--dev'] });
    electron.__siap();
    await tunggu(200);
    cek(
      electron.__menu.some(m => m.label === 'Developer'),
      'menu Developer muncul dengan --dev',
    );
  },
  async 'kamera sony (simulasi): foto, rekam, salin video'() {
    const { panggil, electron, sesi, docsDir } = nyalakanAplikasi();
    electron.__siap();
    await tunggu(200);
    cek((await panggil('sony-status')).mode === 'webcam', 'bawaan memakai webcam');
    const s = await panggil('save-settings', { camera: 'sony-sim' });
    cek(s.camera === 'sony-sim', 'sumber kamera tersimpan');
    cek(
      (await panggil('save-settings', { camera: 'kamera-aneh' })).camera === 'sony-sim',
      'nilai sumber kamera yang tidak dikenal diabaikan',
    );
    await tunggu(700);
    const st = await panggil('sony-status');
    cek(st.connected && /ILCE-6700/.test(st.model) && st.battery === 100, 'kamera simulasi tersambung', st);
    cek(
      electron.__jendela.webContents.sent.some(([n, x]) => n === 'sony-status' && x.connected),
      'layar diberi kabar status kamera',
    );
    const lv = await panggil('sony-live-view');
    cek(Buffer.isBuffer(lv) && lv[0] === 0xff && lv[1] === 0xd8, 'live view berupa gambar JPEG');
    // Mode foto/video tanpa memutar tombol kamera
    const mv = await panggil('sony-mode', 'video');
    cek(mv.ok && mv.kind === 'video' && mv.changed, 'mode kamera pindah ke VIDEO dari aplikasi');
    cek((await panggil('sony-mode', 'video')).changed === false, 'sudah video: tidak dikirim ulang ke kamera');
    const f = await panggil('sony-photo');
    cek(
      f.ok && f.bytes.length > 50000 && f.bytes[0] === 0xff,
      'jepret: foto resolusi penuh masuk',
      f.bytes && f.bytes.length,
    );
    cek(
      (await panggil('sony-mode', '')).skipped && (await panggil('sony-mode', 'video')).changed === true,
      'jepret otomatis memindah kamera ke FOTO dulu',
    );
    await panggil('sony-mode', 'photo');
    const r = await panggil('rec-start', 'message', { sony: true });
    cek(r.id && /_pesan\.mp4$/.test(r.file), 'rekam Sony langsung bernama .mp4', r.file);
    cek(sesi()[0].status === 'recording' && sesi()[0].camera === 'sony', 'sesi tercatat sebagai rekaman kamera Sony');
    cek((await panggil('sony-status')).recording === true, 'status kamera: sedang merekam');
    cek((await panggil('sony-mode', 'video')).changed === false, 'mulai rekam otomatis memindah kamera ke VIDEO dulu');
    await tunggu(300);
    const e = await panggil('rec-end', r.id, 12, { couple: 'Rina & Dimas' });
    cek(
      e.ok && sesi()[0].status === 'transfer' && /^C\d+\.MP4$/.test(sesi()[0].cardFile),
      'berhenti rekam: video disalin dari kartu di belakang',
      sesi()[0],
    );
    await tunggu(1500);
    cek(sesi()[0].status === 'done' && fs.statSync(r.file).size > 10000, 'video tersalin ke folder couple', sesi()[0]);
    cek(
      path.dirname(r.file) === path.join(docsDir, 'VideoboothRecordings', 'Rina & Dimas'),
      'video ada di folder couple',
    );
    // dua rekaman berurutan: penyalinan antre, keduanya selesai
    const a = await panggil('rec-start', 'quiz-1', { sony: true });
    await panggil('rec-end', a.id, 5, {});
    const b = await panggil('rec-start', 'quiz-2', { sony: true });
    await panggil('rec-end', b.id, 5, {});
    await tunggu(3000);
    cek(
      sesi().filter(x => x.status === 'done').length === 3 && fs.existsSync(a.file) && fs.existsSync(b.file),
      'dua rekaman beruntun ikut tersalin',
    );
    await panggil('save-settings', { camera: 'webcam' });
    cek(
      (await panggil('sony-status')).mode === 'webcam' && (await panggil('sony-live-view')) === null,
      'kembali ke webcam: kamera Sony dilepas',
    );
  },

  async 'bahasa tamu'() {
    const { panggil } = nyalakanAplikasi();
    cek((await panggil('get-settings')).language === 'en', 'bawaan bahasa English');
    cek(
      (await panggil('save-settings', { language: 'id' })).language === 'id',
      'bahasa tamu bisa diganti ke Indonesia',
    );
    cek((await panggil('save-settings', { language: 'fr' })).language === 'id', 'bahasa yang tidak dikenal diabaikan');
    cek((await panggil('get-config')).language === 'id', 'bahasa ikut terkirim ke layar saat aplikasi dibuka');
  },

  async 'riwayat sesi: buka, Finder, coba lagi'() {
    const { panggil, electron, sesi, dataDir } = nyalakanAplikasi();
    electron.__siap();
    await tunggu(200);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    await panggil('save-photos', { originals: [jpg], result: jpg, meta: {} });
    const foto = sesi()[0];
    cek(
      (await panggil('session-open', foto.id)).ok && /_hasil\.jpg$/.test(electron.__dibuka),
      'foto hasil bisa dibuka',
    );
    cek(
      (await panggil('session-reveal', foto.id)).ok && /_hasil\.jpg$/.test(electron.__ditunjukkan),
      'foto ditunjukkan di Finder',
    );
    cek(/^data:image\/jpeg;base64,/.test(await panggil('session-thumb', foto.id)), 'gambar kecil foto tersedia');
    // Dengan pembuat thumbnail macOS: satu per satu, disimpan di folder data/thumb, dipakai lagi tanpa membuat ulang
    await panggil('save-photos', { originals: [jpg], result: jpg, meta: {} });
    await panggil('save-photos', { originals: [jpg], result: jpg, meta: {} });
    const [f2, f3] = sesi().slice(-2);
    let jalan = 0,
      puncak = 0,
      dibuat = 0;
    electron.nativeImage = {
      createThumbnailFromPath: async () => {
        jalan++;
        puncak = Math.max(puncak, jalan);
        dibuat++;
        await tunggu(60);
        jalan--;
        return { isEmpty: () => false, toJPEG: () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
      },
      createFromPath: () => ({ resize: () => ({ isEmpty: () => true }), isEmpty: () => true }),
    };
    const [a2, a3] = await Promise.all([panggil('session-thumb', f2.id), panggil('session-thumb', f3.id)]);
    cek(a2 && a3 && puncak === 1, 'gambar kecil dibuat satu per satu (tidak sekaligus)', puncak);
    cek(
      fs.existsSync(path.join(dataDir, 'thumb', f2.id + '.jpg')) &&
        fs.existsSync(path.join(dataDir, 'thumb', f3.id + '.jpg')),
      'gambar kecil disimpan di folder data/thumb',
    );
    await panggil('session-thumb', f2.id);
    cek(dibuat === 2, 'gambar kecil yang sudah ada tidak dibuat ulang');
    delete electron.nativeImage;
    cek((await panggil('session-open', 12345)).error, 'sesi tidak dikenal ditolak dengan pesan');
    cek(
      /doesn't need a retry/.test((await panggil('session-retry', foto.id)).error),
      'sesi yang sudah beres tidak bisa diulang',
    );
    // Video Sony yang tertinggal di kartu: salin lagi
    await panggil('save-settings', { camera: 'sony-sim' });
    await tunggu(700);
    const r = await panggil('rec-start', 'message', { sony: true });
    await panggil('rec-end', r.id, 5, {});
    await tunggu(1500);
    const list = sesi();
    const v = list.find(x => x.label !== 'photo');
    cek(
      v.status === 'done' && v.cardInfo && v.cardInfo.contentId,
      'info file di kartu SD dicatat untuk salin ulang',
      v,
    );
    fs.unlinkSync(r.file);
    list.find(x => x.id === v.id).status = 'card-only';
    fs.writeFileSync(path.join(dataDir, 'sessions.json'), JSON.stringify(list));
    const u = await panggil('session-retry', v.id);
    cek(u.ok && sesi().find(x => x.id === v.id).status === 'transfer', 'Coba salin lagi: status jadi Menyalin', u);
    await tunggu(1500);
    cek(
      sesi().find(x => x.id === v.id).status === 'done' && fs.existsSync(r.file),
      'video tersalin ulang ke folder couple',
    );
    await panggil('save-settings', { camera: 'webcam' });
  },

  async 'video lewat QR: teks quiz ditempel, versi HP, unggah per bagian, halaman video (FFmpeg sungguhan)'() {
    // FFmpeg sungguhan: dari ffmpeg-static (Mac) atau FFmpeg di komputer uji
    let ff = null;
    try {
      ff = require('ffmpeg-static');
    } catch {
      /* ffmpeg-static tidak terpasang: cari FFmpeg di PATH */
    }
    if (!ff) {
      const w = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' });
      ff = (w.stdout || '').trim() || null;
    }
    if (!ff) {
      cek(true, 'FFmpeg tidak ada di komputer ini: uji video dilewati');
      return;
    }
    process.env.LEURA_TEST_FFMPEG = ff;
    process.env.LEURA_TEST_PART_SIZE = String(96 * 1024); // bagian kecil supaya video kecil pun terkirim dalam beberapa bagian
    const os = require('os'),
      http = require('http');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-video-'));
    const ffmpeg = (...a) => spawnSync(ff, ['-hide_banner', '-y', ...a], { encoding: 'utf8' });
    const infoFF = f => ffmpeg('-i', f).stderr || '';
    // Bahan uji: rekaman webm 6 detik (gambar uji + nada), dan 2 gambar teks (PNG)
    const webm = path.join(tmp, 'rekaman.webm');
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440',
      '-t',
      '6',
      '-c:v',
      'libvpx',
      '-b:v',
      '800k',
      '-c:a',
      'libopus',
      webm,
    );
    const png = w => {
      const f = path.join(tmp, w + '.png');
      ffmpeg('-f', 'lavfi', '-i', `color=c=${w}:s=1920x380`, '-frames:v', '1', f);
      return new Uint8Array(fs.readFileSync(f));
    };
    const merah = png('red'),
      biru = png('blue');
    cek(fs.statSync(webm).size > 1000 && merah[0] === 0x89, 'bahan uji dibuat (webm 6 detik + 2 gambar teks)');

    // Server: Worker asli + R2 tiruan yang mendukung unggah per bagian & Range
    const worker = (await import(require('url').pathToFileURL(path.join(__dirname, '..', 'cloud', 'worker.mjs')).href))
      .default;
    const toko = new Map(),
      unggahan = new Map();
    let nUpload = 0;
    const objek = x => ({ customMetadata: x.meta, size: x.data.length, uploaded: new Date() });
    const env = {
      KUNCI_BOOTH: 'kunci-booth-rahasia-123',
      HARI_SIMPAN: '7',
      FOTO: {
        async put(k, data, o) {
          toko.set(k, { data: Buffer.from(data), meta: o.customMetadata });
        },
        async get(k, o) {
          const x = toko.get(k);
          if (!x) return null;
          const r = o && o.range,
            data = r ? x.data.subarray(r.offset, r.offset + r.length) : x.data;
          return { body: data, ...objek(x) };
        },
        async head(k) {
          const x = toko.get(k);
          return x ? objek(x) : null;
        },
        async createMultipartUpload(k, o) {
          const id = 'up' + ++nUpload;
          unggahan.set(id, { k, meta: o.customMetadata, parts: new Map() });
          return { uploadId: id };
        },
        resumeMultipartUpload(k, id) {
          return {
            async uploadPart(n, data) {
              const u = unggahan.get(id);
              if (!u || u.k !== k) throw new Error('NoSuchUpload');
              u.parts.set(n, Buffer.from(data));
              return { partNumber: n, etag: 'e' + n };
            },
            async complete(parts) {
              const u = unggahan.get(id);
              if (!u) throw new Error('NoSuchUpload');
              const data = Buffer.concat(
                parts
                  .slice()
                  .sort((a, b) => a.partNumber - b.partNumber)
                  .map(p => {
                    if (p.etag !== 'e' + p.partNumber) throw new Error('etag');
                    return u.parts.get(p.partNumber);
                  }),
              );
              toko.set(k, { data, meta: u.meta });
              unggahan.delete(id);
              return {};
            },
          };
        },
      },
    };
    let server = null,
      port = 0,
      permintaanBagian = 0;
    const nyalakan = () =>
      new Promise(r => {
        server = http
          .createServer(async (req, res) => {
            const isi = [];
            for await (const c of req) isi.push(c);
            if (/^\/uv\/[^/]+\/\d+/.test(req.url)) permintaanBagian++;
            const jawab = await worker.fetch(
              new Request(`http://127.0.0.1:${port}${req.url}`, {
                method: req.method,
                headers: req.headers,
                body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(isi),
              }),
              env,
            );
            res.writeHead(jawab.status, Object.fromEntries(jawab.headers));
            res.end(Buffer.from(await jawab.arrayBuffer()));
          })
          .listen(port, '127.0.0.1', () => {
            port = server.address().port;
            r();
          });
      });
    const matikan = () =>
      new Promise(r => {
        server.closeAllConnections && server.closeAllConnections();
        server.close(r);
      });
    const ambil = (jalur, o) => fetch(`http://127.0.0.1:${port}${jalur}`, o);
    await nyalakan();

    const { panggil, kirim, electron, sesi, dataDir } = nyalakanAplikasi();
    electron.__siap();
    await tunggu(200);
    const st0 = await panggil('save-upload-settings', {
      url: `http://127.0.0.1:${port}`,
      key: env.KUNCI_BOOTH,
      enabled: true,
    });
    cek(st0.video === true && st0.videoQuality === '720', 'QR video menyala secara bawaan, kualitas bawaan 720p', st0);
    const ping = await (await ambil('/ping', { headers: { authorization: 'Bearer ' + env.KUNCI_BOOTH } })).json();
    cek(ping.video === true, 'server baru memberi tahu bahwa ia mendukung video');

    const rekam = async (label, tamu, meta) => {
      const r = await panggil('rec-start', label, { guest: tamu });
      kirim('rec-chunk', r.id, new Uint8Array(fs.readFileSync(webm)));
      return panggil('rec-end', r.id, 6, { couple: 'Rina & Dimas', ...meta });
    };
    const tungguSesi = async (cari, syarat, ms = 90000) => {
      const t0 = Date.now();
      let s;
      while (Date.now() - t0 < ms) {
        s = sesi().find(cari);
        if (s && syarat(s)) return s;
        await tunggu(250);
      }
      return s;
    };

    // ---- Quiz: teks pertanyaan ditempel, asli disimpan, versi HP diunggah per bagian ----
    const q = await rekam('quiz', 'Sari', {
      questions: ['Di mana kalian bertemu?', 'Doa untuk mereka?'],
      captions: [
        { a: 0.5, b: 2.5, title: 'Di mana kalian bertemu?' },
        { a: 3.5, b: 5.8, title: 'Doa untuk mereka?' },
      ],
      captionImages: [merah, biru],
    });
    const kodeQ = (q.link || '').split('/v/')[1];
    cek(
      q.ok && /^[A-Za-z0-9]{10}$/.test(kodeQ) && q.link === `http://127.0.0.1:${port}/v/${kodeQ}`,
      'rekaman quiz selesai: link QR video langsung ada',
      q,
    );
    const sAwal = sesi().find(x => x.code === kodeQ);
    cek(
      sAwal &&
        sAwal.upload === 'processing' &&
        sAwal.captions.length === 2 &&
        !JSON.stringify(sAwal).includes('captionImages'),
      'sesi mencatat kode QR & waktu pertanyaan (gambar teks tidak masuk sessions.json)',
      sAwal,
    );
    const sQ = await tungguSesi(
      x => x.code === kodeQ,
      x => x.upload === 'sent' || x.upload === 'failed',
    );
    cek(
      sQ && sQ.status === 'done' && sQ.captionStatus === 'done' && sQ.upload === 'sent',
      'video quiz: MP4 → teks ditempel → versi HP → terkirim',
      sQ,
    );
    const utama = path.join(sQ.dir, sQ.file),
      asli = path.join(sQ.dir, 'original', 'Sari_quiz_original.mp4');
    cek(
      sQ.file === 'Sari_quiz.mp4' &&
        fs.existsSync(utama) &&
        fs.existsSync(asli) &&
        fs.existsSync(path.join(sQ.dir, 'original', 'Sari_quiz.webm')),
      'folder couple: Sari_quiz.mp4 (dengan teks), original/Sari_quiz_original.mp4 (tanpa teks) & rekaman webm asli',
    );
    // Warna rata-rata pita bawah video di detik tertentu (teks uji = kotak merah / biru)
    const warna = (f, t) => {
      const r = spawnSync(ff, [
        '-hide_banner',
        '-ss',
        String(t),
        '-i',
        f,
        '-frames:v',
        '1',
        '-vf',
        'crop=iw:ih/8:0:ih*7/8,scale=1:1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        '-',
      ]);
      return [...r.stdout.subarray(0, 3)];
    };
    const [m1, a1, m2, a2, m3] = [
      warna(utama, 1.5),
      warna(asli, 1.5),
      warna(utama, 4.5),
      warna(asli, 4.5),
      warna(utama, 3.0),
    ];
    cek(
      m1[0] > 200 && m1[2] < 80 && m2[2] > 200 && m2[0] < 80,
      'teks pertanyaan 1 tampil di detik 1,5 dan pertanyaan 2 di detik 4,5 (bagian bawah video)',
      { m1, m2 },
    );
    cek(
      Math.abs(m3[0] - warna(asli, 3.0)[0]) < 40 && Math.abs(m3[2] - warna(asli, 3.0)[2]) < 40,
      'di antara pertanyaan (detik 3) tidak ada teks',
      m3,
    );
    cek(
      !(a1[0] > 200 && a1[2] < 80) && !(a2[2] > 200 && a2[0] < 80),
      'video asli di folder original tetap tanpa teks',
      { a1, a2 },
    );
    const ketUtama = infoFF(utama);
    cek(
      /Chapter #0:0/.test(ketUtama) && /Chapter #0:1/.test(ketUtama) && /Di mana kalian bertemu/.test(ketUtama),
      'video diberi bab per pertanyaan (QuickTime/VLC bisa lompat)',
    );
    cek(/Audio: aac/.test(ketUtama) && /Duration: 00:00:0[5-6]/.test(ketUtama), 'suara tetap ada & durasi sama');
    cek(
      !fs.existsSync(path.join(dataDir, 'captions')) || fs.readdirSync(path.join(dataDir, 'captions')).length === 0,
      'gambar teks sementara dihapus setelah ditempel',
    );
    cek(
      !fs.existsSync(path.join(dataDir, 'qr-video')) || fs.readdirSync(path.join(dataDir, 'qr-video')).length === 0,
      'versi HP sementara dihapus setelah terkirim',
    );
    cek(
      permintaanBagian >= 2 && toko.has(`video/${kodeQ}.mp4`) && toko.has(`video/${kodeQ}.jpg`),
      'video dikirim dalam beberapa bagian + gambar sampul',
      permintaanBagian,
    );
    const meta = toko.get(`video/${kodeQ}.mp4`).meta;
    cek(meta.couple === 'Rina & Dimas' && meta.jenis === 'quiz', 'server mencatat nama couple & jenis video', meta);

    // ---- Halaman video untuk tamu ----
    const hal = await (await ambil(`/v/${kodeQ}`)).text();
    cek(
      hal.includes(`src="/vf/${kodeQ}"`) &&
        hal.includes(`poster="/vp/${kodeQ}"`) &&
        hal.includes('playsinline') &&
        hal.includes('Simpan video') &&
        hal.includes('Rina &amp; Dimas') &&
        hal.includes('Quick quiz'),
      'halaman video: pemutar (playsinline + sampul), tombol Simpan video, nama couple, label Quiz',
    );
    cek(
      (await (await ambil(`/v/${kodeQ}?b=en`)).text()).includes('Your video is ready'),
      'halaman video bahasa Inggris (?b=en)',
    );
    const vs = await (await ambil(`/vs/${kodeQ}`)).json();
    cek(vs.ok && vs.ada && vs.jenis === 'quiz' && vs.ukuran > 1000, 'status JSON video', vs);
    const rg = await ambil(`/vf/${kodeQ}`, { headers: { range: 'bytes=0-99' } });
    cek(
      rg.status === 206 &&
        rg.headers.get('content-range') === `bytes 0-99/${vs.ukuran}` &&
        (await rg.arrayBuffer()).byteLength === 100 &&
        rg.headers.get('accept-ranges') === 'bytes',
      'video bisa diputar & digeser di HP (Range → 206)',
    );
    cek(
      (await ambil(`/vf/${kodeQ}`, { headers: { range: `bytes=${vs.ukuran + 5}-` } })).status === 416,
      'Range di luar ukuran video ditolak (416)',
    );
    const dv = await ambil(`/vd/${kodeQ}`);
    cek(
      /attachment; filename="Rina-Dimas_quiz_/.test(dv.headers.get('content-disposition')),
      'unduh video: nama file rapi',
      dv.headers.get('content-disposition'),
    );
    const fileHp = path.join(tmp, 'hp.mp4');
    fs.writeFileSync(fileHp, Buffer.from(await dv.arrayBuffer()));
    const ketHp = infoFF(fileHp);
    cek(
      /Video: h264/.test(ketHp) &&
        / 640x360[ ,[]/.test(ketHp) &&
        /Audio: aac/.test(ketHp) &&
        /Duration: 00:00:0[5-6]/.test(ketHp),
      'video yang diunduh tamu utuh (H.264 + AAC, 6 detik; video kecil tidak diperbesar)',
      (ketHp.match(/Stream.*Video.*/) || [''])[0],
    );
    cek((await ambil(`/vp/${kodeQ}`)).headers.get('content-type') === 'image/jpeg', 'gambar sampul video');
    cek(
      (await (await ambil('/v/BelumAda123')).text()).includes('sedang disiapkan'),
      'video yang belum sampai: halaman "sedang disiapkan" (memeriksa sendiri)',
    );
    cek(
      (await ambil('/uv/AbcdEfgh12/mulai', { method: 'POST' })).status === 401,
      'unggah video tanpa kunci booth ditolak',
    );
    const kunci = { authorization: 'Bearer ' + env.KUNCI_BOOTH };
    cek(
      (await ambil('/uv/AbcdEfgh12/1?u=palsu', { method: 'PUT', body: 'x', headers: kunci })).status === 404,
      'bagian dengan nomor unggah palsu ditolak',
    );

    // ---- Pesan video: tanpa teks; internet putus di tengah → lanjut sendiri ----
    await matikan();
    const p = await rekam('message', 'Budi', {});
    const kodeP = p.link.split('/v/')[1];
    const sP1 = await tungguSesi(
      x => x.code === kodeP,
      x => x.upload === 'waiting',
    );
    const stP = await panggil('upload-status');
    cek(
      sP1 && sP1.upload === 'waiting' && stP.waitingVideos === 1 && /internet/.test(stP.lastError),
      'internet putus: QR video tetap ada, video menunggu',
      stP,
    );
    cek(
      !fs.existsSync(path.join(sP1.dir, 'original', 'Budi_pesan_original.mp4')),
      'pesan video tanpa pertanyaan: tidak dibuat versi tanpa teks',
    );
    await nyalakan();
    await panggil('retry-upload-now');
    const sP = await tungguSesi(
      x => x.code === kodeP,
      x => x.upload === 'sent',
      30000,
    );
    cek(
      sP && sP.upload === 'sent' && toko.get(`video/${kodeP}.mp4`).meta.jenis === 'pesan',
      'internet kembali: video pesan terkirim',
      sP && sP.upload,
    );
    cek(
      (await (await ambil(`/v/${kodeP}`)).text()).includes('Pesan video'),
      'halaman video pesan: label "Pesan video"',
    );

    // ---- Foto didahulukan: foto yang masuk saat video sedang dikirim tetap terkirim lebih dulu ----
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    await matikan();
    const v2 = (await rekam('message', 'Cici', {})).link.split('/v/')[1];
    await tungguSesi(
      x => x.code === v2,
      x => x.upload === 'waiting',
    );
    const f2 = (await panggil('save-photos', { originals: [jpg], result: jpg, meta: {} })).link.split('/f/')[1];
    toko.clear();
    await nyalakan();
    await panggil('retry-upload-now');
    await tungguSesi(
      x => x.code === v2,
      x => x.upload === 'sent',
      30000,
    );
    cek([...toko.keys()][0] === `foto/${f2}.jpg` && toko.has(`video/${v2}.mp4`), 'foto dikirim dulu, baru video', [
      ...toko.keys(),
    ]);

    // ---- QR video dimatikan / kualitas 1080p ----
    const st1 = await panggil('save-upload-settings', { videoQuality: '1080' });
    cek(
      st1.videoQuality === '1080' && st1.video === true && st1.enabled === true,
      'kualitas bisa diganti ke 1080p tanpa mengubah pengaturan lain',
    );
    const st2 = await panggil('save-upload-settings', { video: false });
    cek(st2.video === false && st2.videoQuality === '1080', 'QR video bisa dimatikan');
    const tanpa = await rekam('message', 'Dodi', {});
    cek(tanpa.ok && !tanpa.link, 'QR video mati: rekaman tidak mendapat link QR');
    await tungguSesi(
      x => x.guest === 'Dodi',
      x => x.status === 'done',
    );
    cek(!sesi().find(x => x.guest === 'Dodi').code, 'sesi tanpa kode QR');
    await matikan();
  },

  async 'video lewat QR: dilanjutkan setelah aplikasi ditutup, dan "Process again" (FFmpeg sungguhan)'() {
    let ff = null;
    try {
      ff = require('ffmpeg-static');
    } catch {
      /* ffmpeg-static tidak terpasang: cari FFmpeg di PATH */
    }
    if (!ff) {
      const w = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' });
      ff = (w.stdout || '').trim() || null;
    }
    if (!ff) {
      cek(true, 'FFmpeg tidak ada di komputer ini: uji video dilewati');
      return;
    }
    process.env.LEURA_TEST_FFMPEG = ff;
    const os = require('os'),
      http = require('http');
    const akar = fs.mkdtempSync(path.join(os.tmpdir(), 'videobooth-uji-'));
    const data = path.join(akar, 'data'),
      folder = path.join(akar, 'docs', 'Leura', 'Rina & Dimas');
    // Data in the format of Leura 1.1.x (Indonesian names): main/migrate.js updates it when the app opens
    fs.mkdirSync(path.join(data, 'kapsi'), { recursive: true });
    fs.mkdirSync(folder, { recursive: true });
    const ffmpeg = (...a) => spawnSync(ff, ['-hide_banner', '-y', ...a], { encoding: 'utf8' });
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine',
      '-t',
      '4',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      path.join(folder, 'Ana_quiz.mp4'),
    );
    fs.copyFileSync(path.join(folder, 'Ana_quiz.mp4'), path.join(folder, 'Edo_quiz.mp4'));
    ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=1920x380', '-frames:v', '1', path.join(data, 'kapsi', '111-1.png'));
    // Server QR (Worker asli, R2 tiruan sederhana: video dikirim dalam 1 bagian)
    const worker = (await import(require('url').pathToFileURL(path.join(__dirname, '..', 'cloud', 'worker.mjs')).href))
      .default;
    const toko = new Map(),
      up = new Map();
    const env = {
      KUNCI_BOOTH: 'kunci-booth-rahasia-123',
      HARI_SIMPAN: '7',
      FOTO: {
        async put(k, d, o) {
          toko.set(k, { data: Buffer.from(d), meta: o.customMetadata });
        },
        async get(k) {
          const x = toko.get(k);
          return x ? { body: x.data, customMetadata: x.meta, size: x.data.length } : null;
        },
        async head(k) {
          const x = toko.get(k);
          return x ? { customMetadata: x.meta, size: x.data.length } : null;
        },
        async createMultipartUpload(k, o) {
          up.set('u1', { k, meta: o.customMetadata, b: [] });
          return { uploadId: 'u1' };
        },
        resumeMultipartUpload(k, id) {
          const u = up.get(id);
          return {
            async uploadPart(n, d) {
              if (!u) throw new Error('x');
              u.b[n] = Buffer.from(d);
              return { etag: 'e' + n };
            },
            async complete() {
              if (!u) throw new Error('x');
              toko.set(u.k, { data: Buffer.concat(u.b.filter(Boolean)), meta: u.meta });
              up.delete(id);
            },
          };
        },
      },
    };
    let port = 0;
    const server = await new Promise(r => {
      const s = http
        .createServer(async (req, res) => {
          const isi = [];
          for await (const c of req) isi.push(c);
          const j = await worker.fetch(
            new Request(`http://127.0.0.1:${port}${req.url}`, {
              method: req.method,
              headers: req.headers,
              body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(isi),
            }),
            env,
          );
          res.writeHead(j.status, Object.fromEntries(j.headers));
          res.end(Buffer.from(await j.arrayBuffer()));
        })
        .listen(0, '127.0.0.1', () => {
          port = s.address().port;
          r(s);
        });
    });
    // Keadaan saat aplikasi ditutup: Ana sedang ditempeli teks (QR menunggu versi HP), Edo gambar teksnya hilang
    fs.writeFileSync(
      path.join(data, 'settings.json'),
      JSON.stringify({ unggah: { aktif: true, url: `http://127.0.0.1:${port}`, kunci: env.KUNCI_BOOTH } }),
    );
    const waktu = new Date().toISOString();
    fs.writeFileSync(
      path.join(data, 'sessions.json'),
      JSON.stringify([
        {
          id: 111,
          time: waktu,
          label: 'quiz',
          file: 'Ana_quiz.mp4',
          dir: folder,
          couple: 'Rina & Dimas',
          tamu: 'Ana',
          seconds: 4,
          status: 'teks',
          teks: 'proses',
          kapsi: [{ a: 0.5, b: 3.5, judul: 'Q1' }],
          questions: ['Q1'],
          kode: 'AnaKode123',
          link: `http://127.0.0.1:${port}/v/AnaKode123`,
          unggah: 'olah',
        },
        {
          id: 222,
          time: waktu,
          label: 'quiz',
          file: 'Edo_quiz.mp4',
          dir: folder,
          couple: 'Rina & Dimas',
          tamu: 'Edo',
          seconds: 4,
          status: 'done',
          kapsi: [{ a: 0.5, b: 3.5, judul: 'Q1' }],
          questions: ['Q1'],
        },
      ]),
    );
    fs.writeFileSync(
      path.join(data, 'antrean-unggah.json'),
      JSON.stringify([
        { jenis: 'video', kode: 'AnaKode123', sid: 111, label: 'quiz', couple: 'Rina & Dimas', file: null, bagian: [] },
      ]),
    );

    const { panggil, electron, sesi } = nyalakanAplikasi({ akar });
    electron.__siap();
    const tungguSesi = async (id, syarat, ms = 60000) => {
      const t0 = Date.now();
      let s;
      while (Date.now() - t0 < ms) {
        s = sesi().find(x => x.id === id);
        if (s && syarat(s)) return s;
        await tunggu(250);
      }
      return s;
    };
    const ana = await tungguSesi(111, s => s.upload === 'sent');
    cek(
      ana.status === 'done' &&
        ana.captionStatus === 'done' &&
        ana.upload === 'sent' &&
        fs.existsSync(path.join(folder, 'original', 'Ana_quiz_original.mp4')) &&
        toko.has('video/AnaKode123.mp4'),
      'aplikasi dibuka lagi: teks pertanyaan & unggah video yang terputus dilanjutkan sendiri',
      ana,
    );
    const edo = await tungguSesi(222, s => s.captionStatus === 'failed');
    cek(
      edo.captionStatus === 'failed' && edo.status === 'done' && fs.existsSync(path.join(folder, 'Edo_quiz.mp4')),
      'gambar teks hilang: ditandai gagal, video tetap aman',
      edo,
    );
    ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=1920x380', '-frames:v', '1', path.join(data, 'captions', '222-1.png'));
    cek((await panggil('session-retry', 222)).ok, 'Riwayat: "Process again" bisa ditekan');
    const edo2 = await tungguSesi(222, s => s.captionStatus === 'done');
    cek(
      edo2.captionStatus === 'done' && fs.existsSync(path.join(folder, 'original', 'Edo_quiz_original.mp4')),
      'Process again: teks pertanyaan berhasil ditempel',
      edo2,
    );
    cek(
      (await panggil('session-retry', 222)).error === "This session doesn't need a retry.",
      'sesi yang sudah beres tidak perlu diulang',
    );
    await new Promise(r => {
      server.closeAllConnections && server.closeAllConnections();
      server.close(r);
    });
  },

  async 'unduh foto lewat QR: antrean unggah + server Cloudflare (Worker asli, R2 tiruan)'() {
    const http = require('http');
    const worker = (await import(require('url').pathToFileURL(path.join(__dirname, '..', 'cloud', 'worker.mjs')).href))
      .default;
    const toko = new Map();
    const env = {
      KUNCI_BOOTH: 'kunci-booth-rahasia-123',
      HARI_SIMPAN: '7',
      FOTO: {
        async put(k, data, o) {
          toko.set(k, { data: Buffer.from(data), meta: o.customMetadata });
        },
        async get(k) {
          const x = toko.get(k);
          return x ? { body: x.data, customMetadata: x.meta } : null;
        },
        async head(k) {
          const x = toko.get(k);
          return x ? { customMetadata: x.meta } : null;
        },
      },
    };
    const serverLama = { enabled: false }; // tiruan server versi lama (belum kenal foto satuan)
    let server = null,
      port = 0;
    const nyalakan = () =>
      new Promise(r => {
        server = http
          .createServer(async (req, res) => {
            const isi = [];
            for await (const c of req) isi.push(c);
            if (serverLama.enabled && req.url === '/ping') {
              res.writeHead(200, { 'content-type': 'application/json' });
              return res.end('{"ok":true,"hari":7}');
            }
            const jawab = await worker.fetch(
              new Request(`http://127.0.0.1:${port}${req.url}`, {
                method: req.method,
                headers: req.headers,
                body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(isi),
              }),
              env,
            );
            res.writeHead(jawab.status, Object.fromEntries(jawab.headers));
            res.end(Buffer.from(await jawab.arrayBuffer()));
          })
          .listen(port, '127.0.0.1', () => {
            port = server.address().port;
            r();
          });
      });
    const matikan = () =>
      new Promise(r => {
        server.closeAllConnections && server.closeAllConnections();
        server.close(r);
      });
    const ambil = (jalur, o) => fetch(`http://127.0.0.1:${port}${jalur}`, o);
    await nyalakan();

    const { panggil, electron, sesi, dataDir } = nyalakanAplikasi();
    electron.__siap();
    await tunggu(200);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    cek(
      (await panggil('save-photos', { originals: [jpg], result: jpg, meta: {} })).link === null,
      'QR mati: tidak ada link',
    );
    cek(
      /Enter the server address/.test((await panggil('save-upload-settings', { enabled: true })).error),
      'QR tidak bisa dinyalakan tanpa alamat & kunci',
    );
    cek(
      /https:\/\//.test((await panggil('save-upload-settings', { url: 'http://contoh.com', key: 'x' })).error),
      'alamat selain https ditolak',
    );
    await panggil('save-upload-settings', { url: `http://127.0.0.1:${port}/`, key: 'kunci-salah' });
    cek((await panggil('test-upload')).error === 'Wrong booth key.', 'tes sambungan: kunci salah terdeteksi');
    await panggil('save-upload-settings', { key: env.KUNCI_BOOTH, enabled: true });
    const tes = await panggil('test-upload');
    cek(tes.ok && tes.days === 7, 'tes sambungan berhasil, server menyimpan 7 hari', tes);

    const r = await panggil('save-photos', { originals: [jpg], result: jpg, meta: {} });
    const kode = (r.link || '').split('/f/')[1];
    cek(
      r.ok && /^[A-Za-z0-9]{10}$/.test(kode) && r.link === `http://127.0.0.1:${port}/f/${kode}`,
      'foto disimpan: link QR langsung ada',
      r.link,
    );
    const s1 = sesi().find(x => x.code === kode);
    cek(s1 && s1.upload === 'queued' && s1.link === r.link, 'sesi foto mencatat kode & link QR');
    await tunggu(800);
    cek(
      toko.has(`foto/${kode}.jpg`) && sesi().find(x => x.code === kode).upload === 'sent',
      'foto terunggah ke server di belakang layar',
    );
    const st = await panggil('upload-status');
    cek(st.waiting === 0 && st.sent === 1, 'status antrean: kosong, 1 terkirim', st);

    const hal = await (await ambil(`/f/${kode}`)).text();
    cek(
      hal.includes(`/i/${kode}`) &&
        hal.includes('Simpan foto ini') &&
        hal.includes('Tersedia sampai') &&
        !hal.includes('id="grid"'),
      'halaman unduh: foto template, tombol Simpan, masa simpan; tanpa foto satuan kalau tidak dikirim',
    );
    cek(
      (await (await ambil(`/f/${kode}?b=en`)).text()).includes('Your photos are ready'),
      'halaman unduh bahasa Inggris (?b=en)',
    );
    const d = await ambil(`/d/${kode}`);
    cek(
      /attachment/.test(d.headers.get('content-disposition')) &&
        Buffer.from(await d.arrayBuffer()).equals(Buffer.from(jpg)),
      'tombol unduh mengirim file foto yang sama',
    );
    cek(
      (await (await ambil('/f/BelumAda123')).text()).includes('sedang dikirim'),
      'foto yang belum sampai: halaman "sedang dikirim" (muat ulang sendiri)',
    );
    cek(
      (await (await ambil('/f/BelumAda123?n=200')).text()).includes('tidak ditemukan'),
      'setelah 15 menit: "Foto tidak ditemukan"',
    );

    // Keamanan & masa simpan di server
    cek(
      (await ambil('/u/AbcdEfgh12', { method: 'PUT', body: jpg })).status === 401,
      'unggah tanpa kunci booth ditolak',
    );
    const kunci = { authorization: 'Bearer ' + env.KUNCI_BOOTH };
    cek(
      (await ambil('/u/AbcdEfgh12', { method: 'PUT', body: 'bukan foto', headers: kunci })).status === 415,
      'file bukan JPEG ditolak',
    );
    cek(
      (await ambil('/u/../rahasia', { method: 'PUT', body: jpg, headers: kunci })).status !== 200,
      'kode aneh ditolak',
    );
    toko.set('foto/LamaSekali1.jpg', { data: Buffer.from(jpg), meta: { diunggah: String(Date.now() - 8 * 86400000) } });
    cek((await ambil('/i/LamaSekali1')).status === 404, 'foto lebih dari 7 hari tidak bisa dibuka lagi');

    // Internet putus: link tetap ada, foto menunggu, lalu terkirim saat server kembali
    await matikan();
    const r2 = await panggil('save-photos', { originals: [jpg], result: jpg, meta: {} });
    const kode2 = r2.link.split('/f/')[1];
    await tunggu(1500);
    const st2 = await panggil('upload-status');
    cek(
      r2.link &&
        st2.waiting === 1 &&
        /internet/.test(st2.lastError) &&
        sesi().find(x => x.code === kode2).upload === 'waiting',
      'internet putus: QR tetap ada, foto menunggu dengan pesan jelas',
      st2,
    );
    const simpan = JSON.parse(fs.readFileSync(path.join(dataDir, 'upload-queue.json'), 'utf8'));
    cek(simpan.length === 1 && simpan[0].code === kode2, 'antrean tersimpan di disk (aman kalau aplikasi ditutup)');
    await nyalakan();
    await panggil('retry-upload-now');
    await tunggu(800);
    cek(
      toko.has(`foto/${kode2}.jpg`) && (await panggil('upload-status')).waiting === 0,
      'internet kembali: foto yang tertunda ikut terkirim',
    );

    // Foto satuan: ikut diunggah setelah foto hasil, bisa diunduh satu per satu
    const s1b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 11, 0xff, 0xd9]),
      s2b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 22, 0xff, 0xd9]);
    const r3 = await panggil('save-photos', {
      originals: [jpg, jpg],
      result: jpg,
      singles: [s1b, s2b, new Uint8Array([1, 2, 3])],
      meta: {},
    });
    const kode3 = r3.link.split('/f/')[1];
    await tunggu(1200);
    cek(
      toko.has(`foto/${kode3}-1.jpg`) && toko.has(`foto/${kode3}-2.jpg`) && !toko.has(`foto/${kode3}-3.jpg`),
      'foto satuan terunggah (file yang bukan JPEG dilewati)',
    );
    cek(
      toko.get(`foto/${kode3}.jpg`).meta.jumlah === '2' && toko.get(`foto/${kode3}.jpg`).meta.couple === 'Rina & Dimas',
      'foto hasil membawa jumlah foto satuan & nama couple',
      toko.get(`foto/${kode3}.jpg`).meta,
    );
    cek(
      !fs.existsSync(path.join(dataDir, 'qr-singles')) || fs.readdirSync(path.join(dataDir, 'qr-singles')).length === 0,
      'file sementara foto satuan dihapus setelah terkirim',
    );
    const st3 = await (await ambil(`/s/${kode3}`)).json();
    cek(
      st3.ok && st3.jumlah === 2 && st3.ada.join() === '1,2' && st3.couple === 'Rina & Dimas',
      'status JSON: foto satuan mana yang sudah ada',
      st3,
    );
    const hal3 = await (await ambil(`/f/${kode3}`)).text();
    cek(
      hal3.includes('Foto satuan') &&
        hal3.includes('data-n="2"') &&
        hal3.includes('Simpan semua (3 foto)') &&
        hal3.includes('Rina &amp; Dimas'),
      'halaman unduh: nama couple, foto satuan, tombol Simpan semua (3 foto)',
    );
    const d3 = await ambil(`/d/${kode3}/2`);
    cek(
      /filename="Rina-Dimas_foto-2_/.test(d3.headers.get('content-disposition')) &&
        Buffer.from(await d3.arrayBuffer()).equals(Buffer.from(s2b)),
      'unduh foto satuan ke-2: file benar, nama file rapi',
      d3.headers.get('content-disposition'),
    );
    cek(
      /filename="Rina-Dimas_template_/.test((await ambil(`/d/${kode3}`)).headers.get('content-disposition')),
      'nama file foto template rapi',
    );
    cek(
      (await ambil(`/i/${kode3}/5`)).status === 404 &&
        (await ambil(`/u/${kode3}/9`, { method: 'PUT', body: jpg, headers: kunci })).status !== 200,
      'nomor foto satuan di luar 1–4 ditolak',
    );
    cek(
      (await ambil(`/u/${kode3}/1`, { method: 'PUT', body: jpg })).status === 401,
      'unggah foto satuan tanpa kunci booth ditolak',
    );
    // Urutan saat internet kembali: semua foto hasil dulu, baru foto satuan
    await matikan();
    const a = (await panggil('save-photos', { originals: [jpg], result: jpg, singles: [s1b], meta: {} })).link.split(
      '/f/',
    )[1];
    const b = (await panggil('save-photos', { originals: [jpg], result: jpg, singles: [s2b], meta: {} })).link.split(
      '/f/',
    )[1];
    await nyalakan();
    toko.clear();
    await panggil('retry-upload-now');
    await tunggu(1500);
    const urutan = [...toko.keys()].map(k => k.replace('foto/', '').replace(a, 'A').replace(b, 'B'));
    cek(
      urutan.join() === 'A.jpg,B.jpg,A-1.jpg,B-1.jpg',
      'internet kembali: semua foto hasil dikirim dulu, baru foto satuan',
      urutan,
    );
    // Server versi lama: foto satuan TIDAK dikirim (akan menimpa foto hasil)
    serverLama.enabled = true;
    await panggil('save-upload-settings', {});
    toko.clear();
    const c = (await panggil('save-photos', { originals: [jpg], result: jpg, singles: [s1b], meta: {} })).link.split(
      '/f/',
    )[1];
    await tunggu(1200);
    cek(
      toko.has(`foto/${c}.jpg`) &&
        !toko.has(`foto/${c}-1.jpg`) &&
        (await panggil('upload-status')).waitingSingles === 0 &&
        fs.readdirSync(path.join(dataDir, 'qr-singles')).length === 0,
      'server QR lama: foto satuan dilewati, foto hasil tetap aman',
    );
    await matikan();
  },

  async 'installer Mac (Leura.app): isi paket, program Sony di Resources, versi & lisensi'() {
    const akar = path.join(__dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(akar, 'package.json'), 'utf8'));
    const b = pkg.build || {};
    cek(
      pkg.productName === 'Leura' && b.productName === 'Leura' && b.appId === 'com.leura.booth',
      'nama aplikasi "Leura"',
    );
    cek(
      pkg.scripts['build:mac'] === 'bash installer/build-mac.sh' &&
        fs.existsSync(path.join(akar, 'installer', 'build-mac.sh')),
      'npm run build:mac tersedia',
    );
    cek(
      pkg.dependencies['ffmpeg-static'] &&
        !pkg.dependencies.electron &&
        pkg.devDependencies.electron &&
        pkg.devDependencies['electron-builder'],
      'FFmpeg ikut ke aplikasi; Electron & electron-builder hanya untuk membangun',
    );
    cek(
      (b.asarUnpack || []).some(x => x.includes('ffmpeg-static')),
      'FFmpeg di luar app.asar (bisa dijalankan)',
    );
    const er = b.extraResources || [];
    cek(
      er.some(x => x.from === 'kamera-sony/bin' && x.to === 'kamera-sony/bin') &&
        er.some(x => x.from === 'THIRD-PARTY-NOTICES.txt'),
      'program & pustaka kamera Sony + lisensi ikut ke Contents/Resources',
    );
    cek(
      fs.existsSync(path.join(akar, 'THIRD-PARTY-NOTICES.txt')) &&
        /libusb[\s\S]*Lesser General Public/.test(fs.readFileSync(path.join(akar, 'THIRD-PARTY-NOTICES.txt'), 'utf8')),
      'daftar lisensi pihak ketiga (termasuk libusb LGPL)',
    );
    cek(
      b.mac &&
        b.mac.identity === null &&
        b.mac.extendInfo &&
        /camera/i.test(b.mac.extendInfo.NSCameraUsageDescription) &&
        /microphone/i.test(b.mac.extendInfo.NSMicrophoneUsageDescription),
      'izin kamera & mikrofon tertulis; ditandatangani ad-hoc oleh skrip build',
    );
    cek(fs.existsSync(path.join(akar, b.mac.icon)), 'ikon aplikasi ada');
    // Semua file yang dimuat aplikasi ikut dalam paket
    const pola = (b.files || []).map(f => f.replace('/**/*', '/'));
    const masuk = f => pola.some(p => (p.endsWith('/') ? f.startsWith(p) : f === p));
    const html = fs.readFileSync(path.join(akar, 'index.html'), 'utf8');
    const dimuat = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]);
    // ES modules: follow import '…' / import … from '…' (relative paths) from every loaded .js file
    for (let i = 0; i < dimuat.length; i++) {
      if (!dimuat[i].endsWith('.js') || !fs.existsSync(path.join(akar, dimuat[i]))) continue;
      const code = fs.readFileSync(path.join(akar, dimuat[i]), 'utf8');
      for (const m of code.matchAll(/^\s*(?:import|export)\s[^'"]*?['"](\.{1,2}\/[^'"]+)['"]/gm)) {
        const f = path.posix.normalize(path.posix.join(path.posix.dirname(dimuat[i]), m[1]));
        if (!dimuat.includes(f)) dimuat.push(f);
      }
    }
    const modulTampilan = dimuat.filter(f => f.startsWith('src/'));
    const mainJs = fs.readdirSync(path.join(akar, 'main')).map(f => 'main/' + f);
    const kurang = [...dimuat, ...mainJs, 'main.js', 'preload.js', 'config.json', 'package.json'].filter(
      f => !masuk(f),
    );
    const semuaSrc = fs.readdirSync(path.join(akar, 'src')).filter(f => f.endsWith('.js'));
    const tidakDimuat = semuaSrc.filter(f => !modulTampilan.includes('src/' + f));
    cek(
      !kurang.length && !tidakDimuat.length,
      'semua file tampilan & proses utama ikut ke Leura.app (termasuk modul yang di-import)',
      { kurang, tidakDimuat },
    );
    cek(
      !(b.files || []).some(f => /^(tests|sdk|cloud|demo|kamera-sony)\b/.test(f)),
      'SDK, uji, server & demo tidak ikut ke dalam app.asar',
    );
    cek(
      !fs.existsSync(path.join(akar, 'siapkan-build.js')),
      'skrip lama siapkan-build.js (mengganti nama app) sudah dihapus',
    );

    // Leura.app tiruan: program Sony dicari di Contents/Resources/kamera-sony/bin
    const os = require('os');
    const res = fs.mkdtempSync(path.join(os.tmpdir(), 'leura-resources-'));
    fs.writeFileSync(path.join(res, 'THIRD-PARTY-NOTICES.txt'), 'notices');
    process.resourcesPath = res;
    delete process.env.SONY_HELPER;
    const { panggil, electron, dataDir } = nyalakanAplikasi({ installed: true, platform: 'darwin' });
    electron.__siap();
    await tunggu(100);
    cek(fs.existsSync(path.join(dataDir, 'config.json')), 'Leura.app: config.json bawaan disalin ke folder data');
    const st = (await panggil('save-settings', { camera: 'sony' })) && (await panggil('sony-status'));
    cek(
      !st.connected && /missing from this Leura\.app/.test(st.message) && /npm run build:mac/.test(st.message),
      'Leura.app tanpa program Sony: pesan jelas (bangun ulang installer)',
      st.message,
    );
    const info = await panggil('app-info');
    cek(
      info.version === '1.0.0' && info.installed === true && info.branch === '' && info.licenses === true,
      'Admin → About: versi & aplikasi terpasang',
      info,
    );
    cek(
      (await panggil('open-licenses')).ok && electron.__dibuka === path.join(res, 'THIRD-PARTY-NOTICES.txt'),
      'tombol lisensi membuka THIRD-PARTY-NOTICES.txt dari Resources',
    );
  },

  async 'npm start (folder kode): versi development & branch Git di Admin'() {
    const { panggil, electron } = nyalakanAplikasi();
    electron.__siap();
    await tunggu(50);
    const info = await panggil('app-info');
    const head = (() => {
      try {
        return fs.readFileSync(path.join(__dirname, '..', '.git', 'HEAD'), 'utf8').trim();
      } catch {
        return '';
      }
    })();
    const branch = (head.match(/^ref: refs\/heads\/(.+)$/) || [])[1] || (head ? head.slice(0, 7) : '');
    cek(
      info.installed === false && info.version === '1.0.0' && info.branch === branch,
      'Admin → About: "development" + nama branch dari folder kode',
      info,
    );
  },

  async 'kamera sony: program penghubung belum dibuat'() {
    process.env.SONY_HELPER = path.join(require('os').tmpdir(), 'tidak-ada', 'sony-helper');
    const { panggil, electron, dataDir } = nyalakanAplikasi();
    electron.__siap();
    await tunggu(100);
    const st = (await panggil('save-settings', { camera: 'sony' })) && (await panggil('sony-status'));
    cek(!st.connected && /npm run build:sony/.test(st.message), 'pesan jelas cara membuat program kamera', st.message);
    const f = await panggil('sony-photo');
    cek(/npm run build:sony/.test(f.error), 'jepret ditolak dengan pesan yang sama');
    const r = await panggil('rec-start', 'message', { sony: true });
    const fileSesi = path.join(dataDir, 'sessions.json');
    cek(
      r.error && (!fs.existsSync(fileSesi) || JSON.parse(fs.readFileSync(fileSesi, 'utf8')).length === 0),
      'rekam Sony ditolak, tidak ada sesi kosong',
      r,
    );
  },

  async 'kamera sony: program penghubung asli (SDK palsu)'() {
    const bin = path.join(__dirname, '..', 'kamera-sony', 'uji', 'bin', 'sony-helper-palsu');
    if (!fs.existsSync(bin)) {
      cek(true, 'dilewati: program uji belum dibuat (hanya di komputer pengembang)');
      return;
    }
    process.env.SONY_HELPER = bin;
    const { panggil, electron, sesi, dataDir } = nyalakanAplikasi();
    electron.__siap();
    await tunggu(100);
    await panggil('save-settings', { camera: 'sony' });
    await tunggu(1500);
    const st = await panggil('sony-status');
    cek(st.connected && st.model === 'ILCE-6700' && st.battery === 87, 'program penghubung tersambung lewat SDK', st);
    const lv = await panggil('sony-live-view');
    cek(lv && lv[0] === 0xff && lv[1] === 0xd8, 'live view dari SDK terbaca');
    const f = await panggil('sony-photo');
    cek(f.ok && f.bytes[0] === 0xff, 'jepret lewat SDK berhasil', f.error);
    const r = await panggil('rec-start', 'message', { sony: true });
    await tunggu(500);
    const e = await panggil('rec-end', r.id, 3, {});
    cek(e.ok, 'rekam lewat SDK berhenti & file barunya ditemukan', e.error);
    await tunggu(1500);
    cek(
      sesi()[0].status === 'done' && fs.readFileSync(r.file, 'utf8').startsWith('video palsu'),
      'video tersalin dari "kartu" ke folder couple',
      sesi()[0],
    );
    // Tombol "Tutup aplikasi" di Admin
    const c = await panggil('check-quit');
    cek(c.copying === 0 && c.processing === 0 && c.photos === 0, 'cek sebelum tutup: tidak ada yang tertunda', c);
    // Tombol ✕ jendela / ⌘Q: belum ditutup, tampilan diminta menampilkan dialog konfirmasi
    const tutupJendela = {
      dicegah: false,
      preventDefault() {
        this.dicegah = true;
      },
    };
    electron.__wc.sent.length = 0;
    electron.__jendela.ev.close(tutupJendela);
    cek(
      tutupJendela.dicegah && electron.__wc.sent.some(a => a[0] === 'quit-request'),
      'tombol ✕: jendela tidak langsung tertutup, muncul dialog konfirmasi',
    );
    const cmdQ = {
      dicegah: false,
      preventDefault() {
        this.dicegah = true;
      },
    };
    electron.__appEvents['before-quit'](cmdQ);
    await tunggu(300);
    cek(
      cmdQ.dicegah && !electron.__keluar && electron.__wc.sent.filter(a => a[0] === 'quit-request').length === 2,
      '⌘Q: tanya dulu, kamera belum diputus',
    );
    await panggil('quit-app');
    await tunggu(400);
    cek(electron.__keluar === true, 'Tutup aplikasi memakai jalur resmi (app.quit)');
    const tutupLagi = {
      dicegah: false,
      preventDefault() {
        this.dicegah = true;
      },
    };
    electron.__jendela.ev.close(tutupLagi);
    cek(!tutupLagi.dicegah, 'setelah dikonfirmasi: jendela boleh tertutup');
    electron.__keluar = false;
    const jalan = () => {
      try {
        return require('child_process').execFileSync('pgrep', ['-f', 'sony-helper-palsu$']).toString().trim();
      } catch {
        return '';
      }
    };
    cek(jalan() !== '', 'program penghubung kamera berjalan sebelum ditutup');
    const fileCatatan = path.join(dataDir, 'logs', fs.readdirSync(path.join(dataDir, 'logs'))[0]);
    const isiCatatan = fs.readFileSync(fileCatatan, 'utf8');
    cek(
      /\[Mac state · connected\] camera processes: .*sony-helper[-a-z]* \(pid \d+, started/.test(isiCatatan) &&
        /\[Mac state · connected\] external disks:/.test(isiCatatan),
      'kamera tersambung: kondisi Mac (program kamera, USB, disk) dicatat sekali',
      isiCatatan.split('\n').filter(l => /Mac state/.test(l)),
    );
    const ev = {
      ditahan: false,
      preventDefault() {
        this.ditahan = true;
      },
    };
    const t0 = Date.now();
    electron.__appEvents['before-quit'](ev);
    cek(ev.ditahan && !electron.__keluar, 'saat keluar: aplikasi menunggu kamera diputus dulu');
    while (!electron.__keluar && Date.now() - t0 < 6000) await tunggu(50);
    cek(
      electron.__keluar && Date.now() - t0 < 3500 && jalan() === '',
      'kamera diputus rapi, program penghubung berhenti, lalu aplikasi tertutup',
      Date.now() - t0,
    );
  },

  async 'UI modules (src/): every import has a matching export'() {
    // A missing export stops the whole UI from loading, and ESLint doesn't check names across files.
    const espree = require('espree');
    const dir = path.join(__dirname, '..', 'src');
    const parsed = {};
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
      const code = fs.readFileSync(path.join(dir, f), 'utf8');
      if (/^(import|export)\b/m.test(code))
        parsed[f] = espree.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
    }
    const exportsOf = f => {
      const names = new Set();
      for (const n of parsed[f].body) {
        if (n.type !== 'ExportNamedDeclaration') continue;
        if (n.declaration && n.declaration.id) names.add(n.declaration.id.name);
        if (n.declaration && n.declaration.declarations) n.declaration.declarations.forEach(d => names.add(d.id.name));
        n.specifiers.forEach(s => names.add(s.exported.name));
      }
      return names;
    };
    const problems = [];
    for (const [f, ast] of Object.entries(parsed))
      for (const n of ast.body) {
        if (n.type !== 'ImportDeclaration') continue;
        const target = path.posix.basename(n.source.value);
        if (!parsed[target]) {
          problems.push(`${f}: ${n.source.value} is not a module in src/`);
          continue;
        }
        const have = exportsOf(target);
        for (const s of n.specifiers)
          if (s.type === 'ImportSpecifier' && !have.has(s.imported.name))
            problems.push(`${f}: ${s.imported.name} is not exported by ${target}`);
      }
    cek(Object.keys(parsed).length >= 5 && !problems.length, 'every named import exists in its module', problems);
  },

  async 'QR generator (src/qr.js) gives the same codes'() {
    const crypto = require('crypto');
    const { createQr } = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'qr.js')).href);
    const fingerprint = text => {
      const qr = createQr(text);
      let bits = '';
      for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) bits += qr.isDark(x, y) ? 1 : 0;
      return [qr.size, qr.version, qr.mask, crypto.createHash('sha256').update(bits).digest('hex').slice(0, 16)].join(
        ' ',
      );
    };
    // Recorded from the original generator (before the ES-module refactor); any change here means the QR changed.
    const expected = [
      ['https://leura-foto.uji.workers.dev/f/Ab3dEf9hJk?b=en', '33 4 2 ad837771964d97a5'],
      ['https://x.workers.dev/v/K1', '25 2 1 e34f764b92fcc31d'],
      ['A', '21 1 3 2092585037e9da56'],
      ['Halo 👋 ünïcödé', '25 2 2 1d47b907533f9dbf'],
      ['v'.repeat(121), '45 7 2 4949e6892db29c45'],
      ['v'.repeat(212), '57 10 2 ae3a462359de765c'],
    ];
    for (const [text, want] of expected) {
      const got = fingerprint(text);
      cek(got === want, `QR unchanged: "${text.slice(0, 24)}${text.length > 24 ? '…' : ''}"`, got);
    }
    let threw = false;
    try {
      createQr('z'.repeat(400));
    } catch {
      threw = true;
    }
    cek(threw, 'text too long for a QR code → error (not a broken code)');
  },

  async 'data from Leura 1.1.x (Indonesian names) is updated when the app opens'() {
    const os = require('os');
    const akar = fs.mkdtempSync(path.join(os.tmpdir(), 'videobooth-uji-'));
    const data = path.join(akar, 'data');
    const write = (rel, content) => {
      fs.mkdirSync(path.dirname(path.join(data, rel)), { recursive: true });
      fs.writeFileSync(path.join(data, rel), typeof content === 'string' ? content : JSON.stringify(content));
    };
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    // Exactly what Leura 1.1.3 saved
    const oldSettings = {
      quizSeconds: 30,
      pesanCountdown: 5,
      pesanMaxSeconds: 60,
      enablePesan: false,
      tanyaNama: false,
      kamera: 'sony-sim',
      bahasa: 'id',
      unggah: { aktif: true, url: 'https://leura.example', kunci: 'RAHASIA', video: true, videoKualitas: '1080' },
    };
    write('settings.json', oldSettings);
    write('couples.json', {
      activeId: 'c1',
      couples: [
        {
          id: 'c1',
          name: 'Rina & Dimas',
          welcome: '',
          questions: ['Q'],
          menu: { pesan: false, quiz: true, photo: true },
        },
      ],
    });
    write('templates/t1/template.json', {
      id: 't1',
      coupleId: 'c1',
      nama: 'Rustic',
      ukuran: 'persegi',
      W: 1200,
      H: 1200,
      latarWarna: '#EEEEEE',
      rasio: '1:1',
      filter: null,
      filterKekuatan: 70,
      filterTamu: false,
      slots: [],
      texts: [],
      dibuat: 1,
      diubah: 2,
    });
    write('templates/t1/latar.jpg', Buffer.from([0xff, 0xd8, 0xff]));
    write('templates/t1/bingkai.png', png);
    write('filter/daftar.json', [{ id: 'lut1', nama: 'Hangat', size: 2, dibuat: 3 }]);
    write('filter/lut1.cube', 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
    write('sessions.json', [
      {
        id: 1,
        time: '2026-11-01T10:00:00Z',
        label: 'pesan',
        file: 'Budi_pesan.mp4',
        tamu: 'Budi',
        status: 'done',
        kode: 'K1',
        unggah: 'terkirim',
      },
      {
        id: 2,
        time: '2026-11-01T10:05:00Z',
        label: 'foto',
        file: 'Ani_hasil.jpg',
        status: 'photo',
        kode: 'K2',
        unggah: 'antre',
        bingkai: 'Emas',
      },
      {
        id: 3,
        time: '2026-11-01T10:10:00Z',
        label: 'quiz',
        file: 'Edo_quiz.mp4',
        status: 'done',
        teks: 'gagal',
        kapsi: [{ a: 0.5, b: 2, judul: 'Q' }],
        fileAsli: 'original/Edo_quiz_original.mp4',
      },
      {
        id: 4,
        time: '2026-11-01T10:15:00Z',
        label: 'pesan',
        file: 'Sony_pesan.mp4',
        status: 'card-only',
        kamera: 'sony',
        kartu: 'C0001.MP4',
        kartuInfo: { slot: 1, contentId: 1, fileId: 1 },
      },
    ]);
    const single = path.join(data, 'qr-satuan', '2-1.jpg');
    write('qr-satuan/2-1.jpg', Buffer.from([0xff, 0xd8, 0xff]));
    write('antrean-unggah.json', [
      {
        kode: 'K2',
        sid: 2,
        file: '/x/Ani_hasil.jpg',
        satuan: [single],
        satuanTerkirim: [],
        hasilTerkirim: false,
        coba: 2,
        berikut: 0,
        dibuat: 5,
      },
    ]);
    write('antrean-unggah.json.bak', '[]');
    write('catatan/2099-01-01.txt', 'old log line\n');
    write('kapsi/3-1.png', png);
    write('kapsi/3-bab.txt', ';FFMETADATA1\n');

    const { electron, panggil, dataDir } = nyalakanAplikasi({ akar });
    electron.__siap();
    await tunggu(300);
    const read = rel => JSON.parse(fs.readFileSync(path.join(dataDir, rel), 'utf8'));

    const s = await panggil('get-settings');
    cek(
      s.messageCountdown === 5 && s.messageMaxSeconds === 60 && s.enableMessage === false && s.askName === false,
      'settings: message countdown, time limit, menu & "ask name" kept',
      s,
    );
    cek(
      s.camera === 'sony-sim' && s.language === 'id' && s.quizSeconds === 30,
      'settings: camera source & guest language kept',
      s,
    );
    const u = await panggil('upload-status');
    cek(
      u.enabled && u.hasKey && u.url === 'https://leura.example' && u.videoQuality === '1080',
      'QR settings & booth key kept',
      u,
    );
    cek(
      !JSON.stringify(read('settings.json')).match(/kunci|unggah|tanyaNama|kamera/),
      'settings.json has no old names left',
    );
    cek((await panggil('get-couples')).couples[0].menu.message === false, 'couple menu: "Send a message" stays off');
    const [t] = await panggil('list-templates', 'c1');
    cek(
      t &&
        t.name === 'Rustic' &&
        t.size === 'square' &&
        t.backgroundColor === '#EEEEEE' &&
        t.ratio === '1:1' &&
        t.filterStrength === 70 &&
        t.guestPicksFilter === false &&
        t.created === 1 &&
        t.changed === 2,
      'template: name, size, colors and filter settings kept',
      t,
    );
    cek(
      t && t.backgroundUrl && t.frameUrl,
      'template: background & frame images renamed and still found',
      t && Object.keys(t),
    );
    const f = await panggil('list-filters');
    cek(
      f.length === 1 && f[0].name === 'Hangat' && f[0].created === 3,
      'filter collection kept (filter/filters.json)',
      f,
    );

    const ss = read('sessions.json');
    const byId = id => ss.find(x => x.id === id);
    cek(
      byId(1).label === 'message' &&
        byId(1).guest === 'Budi' &&
        byId(1).code === 'K1' &&
        byId(1).upload === 'sent' &&
        byId(1).file === 'Budi_pesan.mp4',
      'message session: label, guest, QR code & status updated (file name unchanged)',
      byId(1),
    );
    cek(
      byId(2).label === 'photo' && byId(2).upload === 'queued' && byId(2).frame === 'Emas',
      'photo session updated',
      byId(2),
    );
    cek(
      byId(3).captionStatus === 'failed' && byId(3).captions[0].title === 'Q' && byId(3).originalFile,
      'quiz session: question texts updated',
      byId(3),
    );
    cek(
      byId(4).camera === 'sony' && byId(4).cardFile === 'C0001.MP4' && byId(4).cardInfo.contentId === 1,
      'Sony session: card file info kept (Copy again still works)',
      byId(4),
    );
    const q = read('upload-queue.json');
    cek(
      q.length === 1 &&
        q[0].code === 'K2' &&
        q[0].attempts === 2 &&
        q[0].singles[0] === path.join(dataDir, 'qr-singles', '2-1.jpg') &&
        fs.existsSync(q[0].singles[0]),
      'QR upload queue moved to upload-queue.json, single photos to qr-singles/',
      q,
    );
    cek(
      fs.existsSync(path.join(dataDir, 'logs', '2099-01-01.txt')) && !fs.existsSync(path.join(dataDir, 'catatan')),
      'log folder renamed to logs/',
    );
    cek(
      fs.existsSync(path.join(dataDir, 'captions', '3-1.png')) &&
        !fs.existsSync(path.join(dataDir, 'captions', '3-bab.txt')),
      'question text images moved to captions/, old temporary file removed',
    );
    const backups = fs.readdirSync(path.join(dataDir, 'backup'));
    const backup = path.join(dataDir, 'backup', backups[0] || '-');
    cek(
      backups.length === 1 &&
        JSON.stringify(JSON.parse(fs.readFileSync(path.join(backup, 'settings.json'), 'utf8'))) ===
          JSON.stringify(oldSettings) &&
        fs.existsSync(path.join(backup, 'sessions.json')) &&
        fs.existsSync(path.join(backup, 'antrean-unggah.json')) &&
        fs.existsSync(path.join(backup, 'antrean-unggah.json.bak')) &&
        fs.existsSync(path.join(backup, 'templates', 't1', 'template.json')),
      'old files kept unchanged in backup/before-english-data-…',
      backups,
    );
    cek(
      read('settings.json.bak').askName === false && !('tanyaNama' in read('settings.json.bak')),
      '.bak copies have the new names too (a fallback never brings old names back)',
    );
    const log = fs.readFileSync(
      path.join(
        dataDir,
        'logs',
        fs.readdirSync(path.join(dataDir, 'logs')).find(x => x !== '2099-01-01.txt'),
      ),
      'utf8',
    );
    cek(
      /Data from an older version updated/.test(log) && !/RAHASIA/.test(log),
      'update written to the log (without the booth key)',
    );

    // Running again changes nothing (it runs every time the app opens)
    const migrate = require('../main/migrate');
    const before = fs.readFileSync(path.join(dataDir, 'sessions.json'), 'utf8');
    cek(
      migrate.run().length === 0 &&
        fs.readFileSync(path.join(dataDir, 'sessions.json'), 'utf8') === before &&
        fs.readdirSync(path.join(dataDir, 'backup')).length === 1,
      'second run: nothing changed, no new backup',
    );
    // An older Leura version was opened again and saved a setting under the old name: that value wins
    fs.writeFileSync(
      path.join(dataDir, 'settings.json'),
      JSON.stringify({ ...read('settings.json'), tanyaNama: true }),
    );
    migrate.run();
    cek(
      read('settings.json').askName === true && !('tanyaNama' in read('settings.json')),
      'value saved by an older version is taken over',
    );
  },
  async 'satu jendela: aplikasi kedua langsung keluar'() {
    process.on('exit', () => {
      cek(true, 'aplikasi kedua keluar sebelum membuka apa pun');
      const h = hasil();
      if (h.gagal) process.exitCode = 1;
      console.log('##HASIL ' + JSON.stringify(h));
    });
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
  let lulus = 0,
    gagal = 0;
  const akarPulih = fs.mkdtempSync(path.join(require('os').tmpdir(), 'videobooth-pulih-'));
  for (const nama of Object.keys(KASUS)) {
    console.log('\n▶ ' + nama);
    const p = spawnSync(process.execPath, [__filename, nama], {
      encoding: 'utf8',
      env: { ...process.env, AKAR: akarPulih },
    });
    const out = (p.stdout || '') + (p.stderr || '');
    out
      .split('\n')
      .filter(l => l.startsWith('  ') && !l.startsWith('##'))
      .forEach(l => console.log(l));
    const m = out.match(/##HASIL (\{.*\})/);
    if (m) {
      const h = JSON.parse(m[1]);
      lulus += h.lulus;
      gagal += h.gagal;
    } else if (!nama.includes('tahap 1')) {
      gagal++;
      console.log('  ✗ kasus berhenti tanpa hasil:\n' + out.split('\n').slice(-15).join('\n'));
    } else {
      const n = (out.match(/ {2}✓/g) || []).length;
      lulus += n;
      gagal += (out.match(/ {2}✗/g) || []).length;
    }
  }
  console.log(`\n${gagal ? '✗' : '✓'} Uji proses utama: ${lulus} lulus, ${gagal} gagal`);
  process.exit(gagal ? 1 : 0);
}

const nama = process.argv[2];
if (nama && KASUS[nama]) jalankanSatu(nama);
else jalankanSemua();
