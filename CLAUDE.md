# CLAUDE.md — petunjuk untuk Claude di proyek Leura

File ini dibaca Claude di awal setiap session. Gusvin boleh mengubahnya kapan saja.

## Tentang proyek & pemilik

- **Leura**: aplikasi photobooth + videobooth (pesan video & quiz) untuk acara pernikahan. Electron, macOS dulu; versi Windows nanti (`feature/windows-support`) setelah versi Mac matang dan siap lapangan.
- Pemilik: **Gusvin** — bukan programmer. Jelaskan dengan **bahasa Indonesia sederhana**, singkat, tanpa jargon. Kalau perlu istilah teknis, jelaskan artinya.
- Prinsip dari Gusvin: **buat keputusan untuk hasil dan pilihan terbaik, bukan menyesuaikan dengan kemampuan Gusvin.** Kalau ada cara standar industri, pakai itu.
- Leura nantinya dijual di industri pernikahan → kualitas, keamanan data tamu, dan kestabilan saat acara paling penting.
- Catatan lengkap (daftar tertunda, workflow, analisa SDK) ada di Project claude.ai **"Leura side project"** (`claude/daftar-tertunda.md`, `claude/workflow-git.md`).

## Struktur

| Folder / file                   | Isi                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `main.js`, `main/`              | Proses utama Electron (Node, CommonJS). Tiap modul punya `daftarkan()` untuk IPC.        |
| `preload.js`                    | `window.api` lewat contextBridge (contextIsolation + sandbox).                           |
| `index.html`, `src/`, `styles/` | Tampilan: ES module, pintu masuk `src/start.js` (lihat "Tampilan `src/`" di bawah).      |
| `kamera-sony/`                  | Program `sony-helper` (C++, Sony Camera Remote SDK). Dibuat dengan `npm run build:sony`. |
| `cloud/`                        | Server QR (Cloudflare Worker + R2): `worker.mjs`, pasang dengan `npm run cloud:pasang`.  |
| `demo/`                         | Leura Demo untuk HP (`npm run demo:pasang`).                                             |
| `installer/`                    | `build-mac.sh` → Leura.app + .dmg (`npm run build:mac`).                                 |
| `tests/`                        | Uji otomatis (lihat `tests/README.md`).                                                  |

Data acara (couple, rekaman, pengaturan, antrean QR) ada di `~/Library/Application Support/leura`, **bukan** di folder proyek.

## Perintah

- `npm start` — jalankan aplikasi dari kode.
- `npm run cek` — lint + format + semua uji. **Wajib lulus sebelum Pull Request.**
- `npm run test:utama`, `npm run test:tampilan`, `npm run uji:demo` — uji per bagian.
- `npm run lint` / `npm run lint:fix`, `npm run format` / `npm run format:check`.
- `npm run build:mac` — installer Mac (di `main` untuk dipakai acara).
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
- `catch` kosong tidak boleh: beri komentar alasan atau catat ke log (`main/catatan.js`).
- Simpan JSON dengan cara aman yang sudah ada (tmp + fsync + .bak) di `main/penyimpanan.js`.
- FFmpeg dari `ffmpeg-static`; pekerjaan video berurutan lewat `antre()` di `main/olah-video.js`.

## Tampilan `src/`

- Semua file `src/*.js` adalah **ES module** (`src/package.json` = `"type": "module"`). `index.html` hanya memuat `src/start.js`; file lain dimuat lewat `import`. Nama, komentar, dan log bahasa Inggris.
- **Data bersama hanya di `state` (`src/state.js`)**: `state.cfg`, `state.current`, `state.busy`, `state.rec`, `state.guestName`, … Ubah lewat `state.x = …` (modul tidak bisa mengubah variabel modul lain). Alat kecil (`$`, `sleep`, `fmt`, `store`) juga dari `state.js`.
- Tidak ada variabel global antar file. Butuh fungsi dari file lain → `import`. Saling import (siklus) boleh asal hanya dipakai saat berjalan, bukan saat file dimuat.
- `window.__leura` (`src/debug-handle.js`) = pegangan untuk uji tampilan & demo HP saja; aplikasi sendiri tidak memakainya. Uji yang butuh fungsi/data baru → tambahkan di sana.
- `main/filter.js` memakai `src/lut.js` lewat `require()` (require(esm), Electron 45 / Node 24).
- Uji tampilan membuka aplikasi lewat `tests/static-server.js` (http), karena browser menolak modul dari `file://`. Electron sendiri tetap `loadFile`.
- Ganti nama fungsi/file → perbarui juga `src/debug-handle.js`, `tests/uji-tampilan.js` (PALSU) dan `demo/api-demo.js`.
- Nama field data dari proses utama (`judul`, `nama`, `aktif`, `satuan`, `tamu`, kunci `cfg` seperti `tanyaNama`, …), nama `api.*`, id/kelas di HTML/CSS, dan teks pemberitahuan operator belum diganti — itu bagian `refactor/main-english`.
- Uji di `tests/uji-utama.js` memeriksa: setiap `import` punya `export` yang cocok, dan setiap file `src/*.js` benar-benar dimuat (file yang tidak dipakai lagi harus dihapus).

## Uji

- `tests/uji-utama.js` memakai Electron tiruan (`tests/bantu.js`); uji video memakai FFmpeg sungguhan.
- `tests/uji-tampilan.js` memakai Playwright + tiruan `window.api` (string `PALSU`, backslash ditulis ganda); kode di halaman memakai `__leura.*`.
- Setelah mengubah kode: jalankan uji yang relevan, lalu `npm run cek` sebelum PR. Fitur baru → tambah uji.
- GitHub Actions (`.github/workflows/uji.yml`) menjalankan semuanya di setiap PR (±6 menit).

## Status (11 Nov 2026)

- `main` = v1.1.0 + ESLint/Prettier/CI (PR #2). Leura.app 1.1.0 terpasang di Applications.
- `refactor/renderer-modules` (beres-beres langkah 2): `src/` sudah seluruhnya ES module + bahasa Inggris, `prefer-const` menyala, `GLOBAL_TAMPILAN` dihapus. Versi 1.1.1. App sudah dicoba Gusvin; jalur Sony baru diuji dengan kamera tiruan — uji dengan A6700 asli sebelum acara.
- Sesudahnya: `refactor/main-english`, `refactor/sqlite` (node:sqlite, migrasi otomatis dari JSON, simpan cadangan JSON).
- Sebelum acara pertama: `feature/guest-consent` (UU PDP), `feature/admin-security` (Admin tersembunyi, wajib ganti `1234`, kunci setelah salah 5x), cek sisa disk, `fix/sony-0x8210` (butuh A6700), `npm run cloud:pasang`.
