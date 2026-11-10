# Uji otomatis

Jalankan dari folder proyek.

| Perintah                | Isi                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:utama`    | Uji proses utama: couple, pengaturan & login, file rusak, rekaman, disk penuh, pemulihan rekaman, foto, QR, video, installer. Cukup Node.       |
| `npm run test:tampilan` | Uji tampilan: membuka aplikasi di browser dengan kamera palsu lalu menekan tombol seperti tamu (Pesan, Quiz, Admin, Photo booth).               |
| `npm run uji:demo`      | Uji Leura Demo untuk HP.                                                                                                                        |
| `npm test`              | Uji proses utama + tampilan.                                                                                                                    |
| `npm run lint`          | Pemeriksa kode (ESLint): salah ketik, variabel tak terpakai, `catch` kosong, dll. `npm run lint:fix` memperbaiki yang bisa diperbaiki otomatis. |
| `npm run format`        | Merapikan format semua kode (Prettier). `npm run format:check` hanya memeriksa.                                                                 |
| `npm run cek`           | Semuanya: lint, format, semua uji. Jalankan sebelum membuat Pull Request.                                                                       |

Uji tampilan & demo butuh browser Chromium untuk Playwright. Pasang sekali (setelah `npm install`):

```
npx playwright install chromium
```

Di GitHub, semua pemeriksaan ini berjalan otomatis untuk setiap Pull Request (`.github/workflows/uji.yml`).

Jalankan uji setelah mengubah kode. Kalau ada baris bertanda ✗, ada perilaku yang berubah.
