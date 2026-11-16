# Kamera Sony (A6700) lewat USB

Aplikasi mengendalikan kamera Sony lewat **Camera Remote SDK** (mode Remote Transfer):
live view sebagai latar booth, jepret foto resolusi penuh, rekam video ke kartu SD lalu
disalin otomatis ke folder couple.

## Isi folder

- `sony-helper.cpp` — program penghubung SDK Sony (dijalankan aplikasi sebagai proses terpisah)
- `build.sh` — membuat program penghubung di Mac (`npm run build:sony`)
- `../installer/build-sony.js` — `npm run build:sony`: di Mac menjalankan `build.sh`, di Windows membuat `bin-win/sony-helper.exe`
- `simulasi/` — gambar & video untuk mode "Sony – simulasi" (tanpa kamera)
- `uji/sdk-palsu.cpp` — SDK tiruan untuk menguji program penghubung tanpa kamera
- `bin/` — hasil build Mac (tidak ikut Git)
- `bin-win/` — hasil build Windows (tidak ikut Git)
- `hasil-uji/` — hasil `npm run uji:sony` (tidak ikut Git)

## Persiapan sekali saja (Mac)

1. Pasang Xcode Command Line Tools: `xcode-select --install`
2. Pastikan SDK ada di `sdk/sony/SimpleCli.zip`
3. `npm run build:sony`

## Persiapan sekali saja (Windows)

1. Pasang **Build Tools for Visual Studio 2022** dengan **"Desktop development with C++"**
2. Pastikan SDK Sony **versi Windows** ada di `sdk/sony windows/SimpleCli.zip` (berisi `Cr_Core.dll`; zip versi Mac tidak bisa dipakai)
3. `npm run build:sony` → `kamera-sony/bin-win/sony-helper.exe` (runtime C++ ikut disalin, jadi komputer booth tidak perlu memasang Visual C++ Redistributable)
4. **Driver USB Sony** (sekali per komputer): buka `sdk/sony windows/Driver.zip`, ekstrak, klik kanan `srcameradriver.inf` → **Install**. Belum diuji dengan kamera asli; kalau kamera tetap tidak ditemukan, ikuti petunjuk driver di `Camera_Remote_SDK_Readme_v2.02.00.pdf`.

## Pengaturan kamera A6700

- Firmware terbaru
- Menu → Jaringan/USB → **Koneksi USB: PC Remote** (atau "Remote Shooting")
- Kartu SD terpasang (V30 atau lebih cepat), dummy battery NP-FZ100 + adaptor AC
- Mic dicolok ke jack mic kamera (suara video dari kamera)

## Uji dengan kamera asli

1. Sambungkan kamera ke Mac (kabel USB-C data, langsung tanpa hub), nyalakan
2. `npm run uji:sony` → laporan di `kamera-sony/hasil-uji/laporan.txt`
3. Di aplikasi: Admin → Kamera dan mikrofon → Sumber: **Sony (USB)**
