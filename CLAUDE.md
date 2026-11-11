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
| `index.html`, `src/`, `styles/` | Tampilan. `src/*.js` masih **skrip biasa yang berbagi variabel global** (belum modul).   |
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

- Komentar, pesan log, nama file/fungsi saat ini **bahasa Indonesia**. (Rencana: diganti bahasa Inggris bertahap, lihat Langkah berikutnya.)
- **Admin seluruhnya bahasa Inggris.** Layar tamu dua bahasa lewat `src/bahasa.js` (bawaan `en`); teks tamu baru wajib punya kunci di sana.
- Prettier **3.9.10 dikunci persis** (singleQuote, printWidth 120, arrowParens avoid). Jangan naikkan versi tanpa alasan.
- ESLint 10 flat config (`eslint.config.mjs`). Untuk `src/`: `prefer-const` **mati** dan nama global dikumpulkan otomatis (`GLOBAL_TAMPILAN`) — jangan ubah `let` bersama menjadi `const`, file lain mengubahnya.
- `catch` kosong tidak boleh: beri komentar alasan atau catat ke log (`main/catatan.js`).
- Simpan JSON dengan cara aman yang sudah ada (tmp + fsync + .bak) di `main/penyimpanan.js`.
- FFmpeg dari `ffmpeg-static`; pekerjaan video berurutan lewat `antre()` di `main/olah-video.js`.

## Uji

- `tests/uji-utama.js` memakai Electron tiruan (`tests/bantu.js`); uji video memakai FFmpeg sungguhan.
- `tests/uji-tampilan.js` memakai Playwright + tiruan `window.api` (string `PALSU`, backslash ditulis ganda).
- Setelah mengubah kode: jalankan uji yang relevan, lalu `npm run cek` sebelum PR. Fitur baru → tambah uji.
- GitHub Actions (`.github/workflows/uji.yml`) menjalankan semuanya di setiap PR (±6 menit).

## Status (11 Nov 2026)

- `main` = v1.1.0 + ESLint/Prettier/CI (PR #2). Leura.app 1.1.0 terpasang di Applications.
- **Langkah berikutnya (beres-beres langkah 2):** `refactor/renderer-modules` — `src/` jadi ES module + nama bahasa Inggris, per bagian (QR → quiz → pesan → photobooth → Admin → kamera), uji tetap hijau setiap bagian. Setelah selesai: nyalakan lagi `prefer-const` untuk `src/` dan hapus `GLOBAL_TAMPILAN`.
- Sesudahnya: `refactor/main-english`, `refactor/sqlite` (node:sqlite, migrasi otomatis dari JSON, simpan cadangan JSON).
- Sebelum acara pertama: `feature/guest-consent` (UU PDP), `feature/admin-security` (Admin tersembunyi, wajib ganti `1234`, kunci setelah salah 5x), cek sisa disk, `fix/sony-0x8210` (butuh A6700), `npm run cloud:pasang`.
