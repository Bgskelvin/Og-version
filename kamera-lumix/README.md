# Kamera Panasonic Lumix lewat USB (Windows)

Aplikasi mengendalikan kamera Lumix lewat **Lumix Tether SDK** (`Lmxptpif.dll`, khusus Windows):
live view sebagai latar booth, jepret foto (JPEG asli dari kamera), rekam video ke kartu SD lalu
disalin otomatis ke folder couple. Cara kerjanya sama dengan kamera Sony; aplikasi memakai
"bahasa" yang sama untuk keduanya (lihat `kamera-sony/sony-helper.cpp`).

## Isi folder

- `lumix-helper.cpp` — program penghubung SDK Lumix (dijalankan aplikasi sebagai proses terpisah)
- `uji/sdk-palsu.cpp` — SDK tiruan untuk menguji program penghubung tanpa kamera
- `bin/` — hasil build (tidak ikut Git)
- `uji/bin/` — program uji dengan SDK tiruan (tidak ikut Git)

## Persiapan sekali saja (Windows)

1. Pasang **Build Tools for Visual Studio 2022** dengan **"Desktop development with C++"**
   (https://visualstudio.microsoft.com/downloads/ → Tools for Visual Studio).
2. Pastikan SDK ada di `sdk/lumix/Library/` (`LMX_func_api.h`, `Lmxptpif.lib`, `Lmxptpif.dll`).
3. `npm run build:lumix` → `kamera-lumix/bin/lumix-helper.exe`
4. Untuk uji otomatis tanpa kamera: `npm run build:lumix -- --fake`

Lumix tidak butuh driver tambahan: SDK-nya memakai sistem kamera bawaan Windows (WPD).

## Pengaturan kamera

- Firmware terbaru
- Menu → Setup → USB → **Mode USB: PC(Tether)**
- Kartu SD terpasang (V30 atau lebih cepat), dummy battery + adaptor AC
- **Dial mode di P (atau A/S/M), bukan video.** Foto, pesan video, dan quiz semuanya jalan di mode foto.
  S5 II / S5 II X tidak bisa dipindah mode dari komputer (diuji 16 Nov 2026 dengan DC-S5M2X).
- Kualitas video: pilih yang ringan (mis. FHD MP4). Bawaan S5 II X ±21 MB per detik → pesan 1 menit ±1,2 GB.
- Format foto: JPEG atau RAW+JPEG (yang dipakai booth adalah JPEG-nya)
- Mic dicolok ke jack mic kamera (suara video dari kamera)
- Tutup aplikasi lain yang memakai kamera (LUMIX Tether, Windows Photos)

## Mencoba

1. Sambungkan kamera ke laptop (kabel USB data, langsung tanpa hub), nyalakan
2. `npm.cmd start` → Admin → Camera and microphone → Source: **Panasonic Lumix (USB, Windows)**
3. Status di Admin harus "… connected". Coba foto, pesan video, dan quiz.
4. Catatan aplikasi (log) ada di `%APPDATA%\leura\logs` — baris "Lumix camera …".

Catatan: SDK Lumix tidak memberi info baterai & sisa kartu, jadi Admin hanya menampilkan
status tersambung. Pindah mode foto/video dari komputer hanya bisa di sebagian model; kalau
tidak bisa, booth tetap jalan di mode kamera saat itu (Lumix bisa merekam video di mode foto).
