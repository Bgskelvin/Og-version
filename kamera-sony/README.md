# Kamera Sony (A6700) lewat USB

Aplikasi mengendalikan kamera Sony lewat **Camera Remote SDK** (mode Remote Transfer):
live view sebagai latar booth, jepret foto resolusi penuh, rekam video ke kartu SD lalu
disalin otomatis ke folder couple.

## Isi folder

- `sony-helper.cpp` — program penghubung SDK Sony (dijalankan aplikasi sebagai proses terpisah)
- `build.sh` — membuat program penghubung di Mac (`npm run build:sony`)
- `simulasi/` — gambar & video untuk mode "Sony – simulasi" (tanpa kamera)
- `uji/sdk-palsu.cpp` — SDK tiruan untuk menguji program penghubung tanpa kamera
- `bin/` — hasil build (tidak ikut Git)
- `hasil-uji/` — hasil `npm run uji:sony` (tidak ikut Git)

## Persiapan sekali saja (Mac)

1. Pasang Xcode Command Line Tools: `xcode-select --install`
2. Pastikan SDK ada di `sdk/sony/SimpleCli.zip`
3. `npm run build:sony`

## Pengaturan kamera A6700

- Firmware terbaru
- Menu → Jaringan/USB → **Koneksi USB: PC Remote** (atau "Remote Shooting")
- Kartu SD terpasang (V30 atau lebih cepat), dummy battery NP-FZ100 + adaptor AC
- Mic dicolok ke jack mic kamera (suara video dari kamera)

## Uji dengan kamera asli

1. Sambungkan kamera ke Mac (kabel USB-C data, langsung tanpa hub), nyalakan
2. `npm run uji:sony` → laporan di `kamera-sony/hasil-uji/laporan.txt`
3. Di aplikasi: Admin → Kamera dan mikrofon → Sumber: **Sony (USB)**
