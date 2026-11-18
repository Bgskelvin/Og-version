# CLAUDE.md — petunjuk untuk Claude di proyek Leura

File ini dibaca Claude di awal setiap session. Gusvin boleh mengubahnya kapan saja.

## Tentang proyek & pemilik

- **Leura**: aplikasi photobooth + videobooth (pesan video & quiz) untuk acara pernikahan. Electron, macOS dulu; versi Windows nanti (`feature/windows-support`) setelah versi Mac matang dan siap lapangan.
- Pemilik: **Gusvin** — bukan programmer. Jelaskan dengan **bahasa Indonesia sederhana**, singkat, tanpa jargon. Kalau perlu istilah teknis, jelaskan artinya.
- Prinsip dari Gusvin: **buat keputusan untuk hasil dan pilihan terbaik, bukan menyesuaikan dengan kemampuan Gusvin.** Kalau ada cara standar industri, pakai itu.
- Leura nantinya dijual di industri pernikahan → kualitas, keamanan data tamu, dan kestabilan saat acara paling penting.
- Catatan lengkap (daftar tertunda, workflow, analisa SDK) ada di Project claude.ai **"Leura side project"** (`claude/daftar-tertunda.md`, `claude/workflow-git.md`).

## Struktur

| Folder / file                   | Isi                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `main.js`, `main/`              | Proses utama Electron (Node, CommonJS). Tiap modul punya `register()` untuk IPC.           |
| `preload.js`                    | `window.api` lewat contextBridge (contextIsolation + sandbox).                             |
| `index.html`, `src/`, `styles/` | Tampilan: ES module, pintu masuk `src/start.js` (lihat "Tampilan `src/`" di bawah).        |
| `kamera-sony/`                  | Program `sony-helper` (C++, Sony Camera Remote SDK). Dibuat dengan `npm run build:sony`.   |
| `kamera-lumix/`                 | Program `lumix-helper.exe` (C++, Lumix Tether SDK, khusus Windows). `npm run build:lumix`. |
| `cloud/`                        | Server QR (Cloudflare Worker + R2): `worker.mjs`, pasang dengan `npm run cloud:pasang`.    |
| `demo/`                         | Leura Demo untuk HP (`npm run demo:pasang`).                                               |
| `installer/`                    | `build-mac.sh` → Leura.app + .dmg (`npm run build:mac`); `build-win.js` → .exe (Windows).  |
| `tests/`                        | Uji otomatis (lihat `tests/README.md`).                                                    |

Data acara ada di `~/Library/Application Support/leura`, **bukan** di folder proyek. Pengaturan, couple, riwayat sesi, dan antrean QR ada di database `leura.db` (lihat Konvensi kode); rekaman/foto di folder couple; template & filter tetap file JSON + gambar.

## Perintah

- `npm start` — jalankan aplikasi dari kode.
- `npm run cek` — lint + format + semua uji. **Wajib lulus sebelum Pull Request.**
- `npm run test:utama`, `npm run test:tampilan`, `npm run uji:demo` — uji per bagian.
- `npm run lint` / `npm run lint:fix`, `npm run format` / `npm run format:check`.
- `npm run build:mac` — installer Mac (di `main` untuk dipakai acara).
- `npm run build:win` — installer Windows `Leura-Setup-<versi>-x64.exe` (hanya di Windows). GitHub juga membuatnya otomatis (`.github/workflows/installer-windows.yml`: tombol Run workflow, setiap tag `v*`, PR yang mengubah installer) → unduh di Artifacts. Program kamera Sony (`kamera-sony/bin-win`) & Lumix (`kamera-lumix/bin`) ikut masuk kalau sudah dibuat di komputer itu (`build.win.extraResources`); GitHub tidak punya SDK, jadi installer dari GitHub hanya webcam. Pustaka Sony Mac hanya di `build.mac.extraResources`.
- `npm run build:sony` — Mac: `kamera-sony/build.sh` → `bin/`; Windows: `installer/build-sony.js` → `bin-win/` (butuh SDK Windows di `sdk/sony windows/` + Build Tools for Visual Studio 2022, C++).
- `npm run build:lumix` — `kamera-lumix/bin/lumix-helper.exe` (Windows, Build Tools C++). `-- --fake` = program uji dengan SDK tiruan untuk `test:utama`.
- `npm run uji:sony`, `uji:sony-tidur`, `uji:sony-mode` — butuh kamera Sony A6700 tersambung.

## Workflow Git — GitHub Flow

- Repo: `github.com/Bgskelvin/Og-version`. `main` selalu stabil; **tidak ada pekerjaan langsung di `main`.**
- Satu pekerjaan = satu branch dari `main`: `feature/`, `fix/`, `hotfix/`, `experiment/`, `refactor/`, `chore/`, `docs/` + deskripsi huruf kecil pakai tanda minus.
- Commit kecil-kecil. Push branch → Pull Request → **Gusvin yang menekan Merge** → hapus branch → tag versi di `main`.
- Versi SemVer di `package.json` (dinaikkan di branch sebelum PR). Tag `vX.Y.Z` setelah merge.
- Di git, tulis **`refs/heads/main`** atau `main --` — folder `main/` membuat `main` ambigu.
- Selalu sebutkan branch yang sedang aktif ke Gusvin.
- `gh` dan `brew` tidak terpasang. PR dibuat lewat halaman GitHub (beri Gusvin link + judul + isi PR).

## Aturan wajib

- **`sdk/` tidak boleh masuk Git** (SDK kamera berlisensi). Jangan menyalin isinya ke file lain yang di-commit.
- **Kunci booth** (`cloud/.hasil-pasang.json`, pengaturan unggah) jangan pernah ditampilkan, dicatat ke log, atau di-commit.
- **Token GitHub** jangan pernah diminta atau ditampilkan.
- Jangan membongkar/menyalin kode berlisensi (mis. CascableCore). Belajar dari standar PTP / libgphoto2 saja.
- Jangan `npm audit fix --force`.
- Repo sengaja **Public** (pilihan Gusvin) — anggap semua yang di-commit bisa dibaca orang lain.
- Hapus file (rm) atau ubah hal yang tidak bisa dibatalkan: tanya dulu.

## Konvensi kode

- **Bicara dengan Gusvin: bahasa Indonesia. Kode baru: bahasa Inggris.** Semua nama variabel, fungsi, file, dan branch yang baru dibuat pakai bahasa Inggris (pilihan Gusvin, 11 Nov 2026).
- Kode lama masih memakai nama, komentar, dan pesan log **bahasa Indonesia**. Kode itu diganti ke bahasa Inggris bertahap lewat refactor (lihat Langkah berikutnya), bukan diubah sedikit-sedikit di tengah pekerjaan lain.
- **Admin seluruhnya bahasa Inggris.** Layar tamu dua bahasa lewat `src/language.js` (bawaan `en`); teks tamu baru wajib punya kunci di sana.
- Prettier **3.9.10 dikunci persis** (singleQuote, printWidth 120, arrowParens avoid). Jangan naikkan versi tanpa alasan.
- ESLint 10 flat config (`eslint.config.mjs`). `src/` diperiksa sebagai ES module (browser + `api`), `prefer-const` menyala di semua kode.
- `catch` kosong tidak boleh: beri komentar alasan atau catat ke log (`main/log.js`).
- **Database** (v1.4.0): `main/database.js`, SQLite bawaan Electron (`node:sqlite`), file `<data>/leura.db`. Tabel `settings`, `couples`, `sessions`, `upload_queue`, `app_state`; isi tiap baris JSON (kolom `data`). Setiap perubahan satu transaksi; cadangan harian di `<data>/backup/database/` (7 hari); file rusak disisihkan (`leura.db.corrupt-…`) dan cadangan terbaru dipakai. Modul lain memakai fungsi di `main/storage.js` (`readSettings`, `getSession`, `saveSession`, `updateSession`, `db.*`), bukan SQL langsung.
- **Mengubah susunan tabel → tambah langkah baru di `SCHEMA` (`main/database.js`) + uji.** Langkah yang sudah dirilis tidak boleh diubah.
- File JSON yang masih ada (template, filter) disimpan dengan cara aman (tmp + fsync + .bak) lewat `readJSON`/`writeJSON` di `main/storage.js`.
- Nama data tersimpan (settings, sesi, couple, template, filter, antrean QR, folder di data) bahasa Inggris. Data dari versi lama diubah otomatis oleh `main/migrate.js` saat app dibuka (aman diulang, cadangan di `<data>/backup/`); langkah terakhirnya memindahkan file JSON lama ke database (file JSON disimpan di `backup/before-database-…`). **Mengganti nama data tersimpan → tambah langkah di `main/migrate.js` + uji.**
- Protokol program kamera Sony (`kamera-sony/sony-helper.cpp`) dan server QR (`cloud/worker.mjs`) tetap memakai kata Indonesia (`sambung`, `tersambung`, `satuan`, `bagian`, …). Diterjemahkan di batasnya saja: `main/sony-camera.js` dan `main/upload.js`.
- Nama file rekaman pesan tetap `Nama_pesan.mp4` (`FILE_LABELS` di `main/recording.js`), meski labelnya `message`.
- **Kamera USB** (`main/sony-camera.js`): sumber `sony`, `sony-sim`, `lumix`. Sony & Lumix memakai protokol program penghubung yang SAMA (perintah `sambung`, `foto`, `rekam-mulai`, … — lihat kepala `kamera-sony/sony-helper.cpp` & `kamera-lumix/lumix-helper.cpp`); nama yang tampil lewat `brandName()` (main) / `cameraBrand()` (src). Nama file & fungsi masih `sony-*` (dipakai untuk kedua kamera). Sesi menyimpan `camera: 'sony' | 'lumix'`.
- FFmpeg dari `ffmpeg-static`; pekerjaan video berurutan lewat `enqueue()` di `main/video-processing.js`.
- Semua encode video lewat `encode()` (`main/video-processing.js`): Mac = chip video (`h264_videotoolbox`), Windows = kartu grafis (`WINDOWS_ENCODERS`: NVIDIA → Intel → AMD, dicoba sekali saat app dibuka, hasilnya di log). Gagal → libx264. Konversi .webm → .mp4 di Mac tetap libx264 (`macChip: false`).

## Tampilan `src/`

- Semua file `src/*.js` adalah **ES module** (`src/package.json` = `"type": "module"`). `index.html` hanya memuat `src/start.js`; file lain dimuat lewat `import`. Nama, komentar, dan log bahasa Inggris.
- **Data bersama hanya di `state` (`src/state.js`)**: `state.cfg`, `state.current`, `state.busy`, `state.rec`, `state.guestName`, … Ubah lewat `state.x = …` (modul tidak bisa mengubah variabel modul lain). Alat kecil (`$`, `sleep`, `fmt`, `store`) juga dari `state.js`.
- Tidak ada variabel global antar file. Butuh fungsi dari file lain → `import`. Saling import (siklus) boleh asal hanya dipakai saat berjalan, bukan saat file dimuat.
- `window.__leura` (`src/debug-handle.js`) = pegangan untuk uji tampilan & demo HP saja; aplikasi sendiri tidak memakainya. Uji yang butuh fungsi/data baru → tambahkan di sana.
- `main/filter.js` memakai `src/lut.js` lewat `require()` (require(esm), Electron 45 / Node 24).
- Uji tampilan membuka aplikasi lewat `tests/static-server.js` (http), karena browser menolak modul dari `file://`. Electron sendiri tetap `loadFile`.
- Ganti nama fungsi/file → perbarui juga `src/debug-handle.js`, `tests/uji-tampilan.js` (PALSU) dan `demo/api-demo.js`.
- Semua nama tampilan bahasa Inggris (v1.3.1): `api.*`, IPC, field data, id/kelas HTML/CSS, nama layar (`start`, `name`, `home`, `message`, `quiz`, `coupleForm`, `history`, …), kunci kamus `src/language.js` (`thanks.ok`, `home.message`, …) dan teks pemberitahuan operator. Teks tamu bahasa Indonesia tetap di HTML (atribut `data-t`) dan di `DICTIONARY.id`. Kode demo (`demo/`) masih memakai nama Indonesia.
- Uji di `tests/uji-utama.js` memeriksa: setiap `import` punya `export` yang cocok, dan setiap file `src/*.js` benar-benar dimuat (file yang tidak dipakai lagi harus dihapus).

## Uji

- `tests/uji-utama.js` memakai Electron tiruan (`tests/bantu.js`); uji video memakai FFmpeg sungguhan.
- `tests/uji-tampilan.js` memakai Playwright + tiruan `window.api` (string `PALSU`, backslash ditulis ganda); kode di halaman memakai `__leura.*`.
- Setelah mengubah kode: jalankan uji yang relevan, lalu `npm run cek` sebelum PR. Fitur baru → tambah uji.
- GitHub Actions (`.github/workflows/uji.yml`) menjalankan semuanya di setiap PR (±6 menit).

## Status (14 Nov 2026)

- **Versi Windows** (`feature/windows-usb-cameras`, v1.7.0, 16 Nov 2026): kamera Lumix (DC-S5M2X diuji asli: live view, foto, video, salin dari kartu; dial harus di P/A/S/M) & Sony (program dibuat, belum diuji kamera asli), video lewat kartu grafis (v1.6.1). Belum selesai / belum teruji:
  - Live view lebih lancar: kamera menawarkan 640×480, 960×720, 1280×960 (semua "30fps", yang sampai ±10 gambar/detik). Ukur dengan `LUMIX_LV=0|1|2` + alat ukur (scratchpad `lv-fps.js`) saat kamera tersambung.
  - "Stop rekam dicoba ulang" (kamera sibuk) baru teruji dengan kamera tiruan.
  - Sony di Windows belum dicoba dengan kamera asli; driver USB (`sdk/sony windows/Driver.zip`) perlu dipasang dulu.
  - QR: 16 Nov 2026 server dipasang ulang dari Windows (`npm run cloud:pasang`, v1.7.1: lewat Git Bash) → **kunci booth baru**, ada di `cloud/.hasil-pasang.json` di Windows. Kunci lama di Mac tidak berlaku lagi: salin file itu ke Mac lalu Admin → "Load from setup".
  - Kamera Lumix terputus sekali (16 Nov 10:01, kode 0x40003, lalu tidak terlihat Windows ±3 menit): sebab belum diketahui (Auto Power Off? kabel?).
  - Lumix GH6 (DC-GH6) tersambung & merekam (17 Nov 2026). v1.7.3 (`fix/lumix-camera-redetect`): saat app dibuka, sumber kamera dibaca dari nama lama `kamera` (bukan `camera`) → kamera USB tidak menyala sampai sumber dipilih ulang di Admin. Berlaku juga untuk Sony & versi Mac sejak v1.3.1.
  - Installer di `dist/` dari branch ini hanya untuk percobaan; installer acara dibuat ulang dari `main` setelah merge.
  - Alat Claude melihat salinan `%APPDATA%` sendiri: log/database asli Gusvin hanya bisa dibaca kalau Gusvin menempelkannya.

- `main` = v1.4.1 (tombol Admin hanya ikon kecil samar). v1.4.0: database SQLite (lihat Konvensi kode). Sebelumnya v1.3.1: `src/`/`main/`/IPC/data bahasa Inggris, `main/migrate.js` mengubah data lama otomatis. Leura 1.4.1 sudah dibuat (`dist/`); Leura.app di Applications masih 1.1.0. Jalur Sony baru diuji dengan kamera tiruan — uji dengan A6700 asli sebelum acara. Keamanan Admin lengkap ditunda oleh Gusvin.
- `feature/combined-guest-qr` (v1.5.0): **satu QR per tamu**. Terima kasih tanpa QR/tombol, kembali sendiri ke menu dengan animasi (4,5 dtk pesan/quiz, 6,5 dtk foto, 9 dtk gagal; ketuk = langsung). Menu: tombol besar "Finish & get QR" (`src/guest-qr.js`) → layar `guestQr`. Tamu pergi tanpa menekan → saat diam di halaman pesan/quiz/foto, QR tetap tampil dulu. v1.8.0 (`feature/menu-admin-no-idle`): menu utama **tidak pernah** kembali sendiri ke Start/QR; tombol Admin (ikon kecil) juga ada di halaman nama tamu, dan Admin kembali ke halaman asalnya. Tombol kembali (ikon, pojok kiri atas) di menu utama selama tamu belum sampai di halaman Terima kasih: ke halaman nama (nama lama tetap terisi) atau ke Start kalau nama tidak ditanya. Halaman nama: tombol kembali ikon → Start. Server: `PUT /ut`, `GET /t` & `/ts` di `cloud/worker.mjs` → server yang terpasang (`leura-foto.leuraa.workers.dev`) sudah versi ini (dipasang 16 Nov 2026). Server lama: beberapa hasil = link hasil pertama saja (aplikasi bertanya ke server dulu). Satu hasil = link hasil itu sendiri.
- `feature/photo-print` (v1.9.0, 18 Nov 2026): **cetak foto**. Edit foto → Selesai → layar `printCopies` (`src/print-choice.js`: foto tamu + pilih 1…batas Admin, animasi masuk/keluar) → Terima kasih. Foto disimpan di latar belakang selama tamu memilih. Diam 45 dtk = jumlah terpilih dicetak sendiri. QR hanya di foto cetak (`tpl.qr`, editor template → tab "Print QR", kotaknya seperti kotak foto; juga terlihat di Edit foto kalau akan dicetak dengan QR; layout bawaan Grid/1 besar punya QR tetap, Strip tidak). `main/print.js`: antrean di `app_state.printQueue`, satu per satu, gagal → Admin "Retry failed"; kertas 4×6, strip 2 per lembar. Printer kosong = "Save as PDF (test)" → PDF di `<couple>/Foto/Print`. Riwayat sesi → sesi foto → "Print" → pilih 1–6: foto hasil + QR di tempat yang sama (`printQr` disimpan di sesi; sesi lama tanpa QR), jumlah cetak dijumlah di `prints`. Belum diuji dengan printer asli.
- Sebelum dijual: `feature/admin-security` (layar sentuh tanpa keyboard: ketuk pojok 5x, PIN 6 angka di layar, wajib ganti `1234`, kunci sementara setelah salah 5x, Admin terkunci otomatis 2 menit, kode pemulihan). Sebelum acara pertama: `fix/sony-0x8210` (butuh A6700).
