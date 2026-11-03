# Uji otomatis

Jalankan dari folder proyek.

| Perintah | Isi |
|---|---|
| `npm run test:utama` | Uji proses utama: couple, pengaturan & login, file rusak, rekaman, disk penuh, pemulihan rekaman, foto, jendela. Cukup Node, tidak perlu pasang apa pun. |
| `npm run test:tampilan` | Uji tampilan: membuka aplikasi di browser dengan kamera palsu lalu menekan tombol seperti tamu (Pesan, Quiz, Admin, Photo booth). |
| `npm test` | Keduanya. |

Uji tampilan butuh Playwright. Pasang sekali:

```
npm install --save-dev playwright
npx playwright install chromium
```

Jalankan uji setelah mengubah kode. Kalau ada baris bertanda ✗, ada perilaku yang berubah.
