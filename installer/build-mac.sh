#!/bin/bash
# =====================================================================
# build-mac.sh — membuat installer Leura untuk Mac (Leura.app + .dmg)
# Jalankan dari folder proyek:   npm run build:mac
#
# Isi Leura.app:
#   - kode aplikasi (app.asar)
#   - FFmpeg (MP4, teks quiz, versi HP untuk QR)       → app.asar.unpacked
#   - program kamera Sony + pustaka SDK Sony + lisensi → Resources/kamera-sony/bin
#   - THIRD-PARTY-NOTICES.txt                          → Resources/
# Data (couple, rekaman, pengaturan, antrean QR) TIDAK ikut: tetap di
#   ~/Library/Application Support/leura  — sama dengan "npm start".
# Hasil:  dist/Leura-<versi>-<arm64|x64>.dmg  dan  dist/mac*/Leura.app
# =====================================================================
set -e
cd "$(dirname "$0")/.."

say()   { printf '\n▶ %s\n' "$1"; }
oke()   { printf '  ✓ %s\n' "$1"; }
awas()  { printf '  ⚠ %s\n' "$1"; }
gagal() { printf '\n✗ %s\n\n' "$1"; exit 1; }

[ "$(uname)" = "Darwin" ] || gagal "Installer Mac hanya bisa dibuat di Mac."
VERSI=$(node -p "require('./package.json').version")
BRANCH=$(git branch --show-current 2>/dev/null || echo '-')
printf '\nLeura %s  ·  branch %s\n' "$VERSI" "$BRANCH"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then awas "Ada perubahan yang belum di-commit — installer memakai isi folder apa adanya."; fi
if [ "$BRANCH" != "main" ]; then awas "Bukan branch main: installer ini untuk mencoba, bukan untuk acara."; fi

say "Memeriksa komponen"
if [ ! -x node_modules/.bin/electron-builder ] || [ ! -d node_modules/ffmpeg-static ]; then
  printf '  Memasang komponen (npm install)…\n'
  npm install --no-audit --no-fund
fi
FF=$(node -p "require('ffmpeg-static') || ''")
[ -n "$FF" ] && [ -x "$FF" ] || gagal "FFmpeg (ffmpeg-static) tidak ditemukan. Jalankan: npm install"
"$FF" -hide_banner -version >/dev/null 2>&1 || gagal "FFmpeg ada tapi tidak bisa dijalankan di Mac ini: $FF"
oke "FFmpeg $(file -b "$FF" | grep -o 'arm64\|x86_64' | head -1)"

# Program kamera Sony + lisensi pustakanya (dibuat dari SDK di sdk/sony)
if [ ! -x kamera-sony/bin/sony-helper ] || [ ! -s kamera-sony/bin/licenses/libusb-COPYING.txt ]; then
  if [ -f sdk/sony/SimpleCli.zip ]; then
    printf '  Membuat program kamera Sony (npm run build:sony)…\n'
    bash kamera-sony/build.sh
  elif [ "$LEURA_TANPA_SONY" = "1" ]; then
    awas "Tanpa kamera Sony (LEURA_TANPA_SONY=1)."
    mkdir -p kamera-sony/bin
  else
    gagal "Program kamera Sony belum ada dan SDK Sony (sdk/sony/SimpleCli.zip) tidak ditemukan."
  fi
fi
if [ -x kamera-sony/bin/sony-helper ]; then
  kamera-sony/bin/sony-helper </dev/null | head -1 | grep -q '"siap"' || gagal "kamera-sony/bin/sony-helper tidak bisa dijalankan. Jalankan: npm run build:sony"
  oke "Program kamera Sony + pustaka SDK ($(du -sh kamera-sony/bin | cut -f1))"
fi
[ -f THIRD-PARTY-NOTICES.txt ] || gagal "THIRD-PARTY-NOTICES.txt hilang."

say "Membuat Leura.app (beberapa menit)"
rm -rf dist
npx electron-builder --mac dir --publish never
APP=$(ls -d dist/mac*/Leura.app 2>/dev/null | head -1)
[ -d "$APP" ] || gagal "Leura.app tidak ditemukan di dist/."

# Tanpa akun Apple Developer: tanda tangan "ad-hoc" untuk seluruh isi aplikasi
# (termasuk program & pustaka Sony). Tanpa ini Mac Apple Silicon bisa menyebut aplikasinya "rusak".
say "Menandatangani Leura.app (ad-hoc)"
xattr -cr "$APP" 2>/dev/null || true
codesign --force --deep --sign - "$APP"
oke "Ditandatangani"

say "Membuat installer .dmg"
npx electron-builder --mac dmg --publish never --prepackaged "$APP"

say "Memeriksa hasil"
RES="$APP/Contents/Resources"
FFAPP=$(find "$RES/app.asar.unpacked/node_modules/ffmpeg-static" -maxdepth 1 -name ffmpeg -type f | head -1)
[ -n "$FFAPP" ] && "$FFAPP" -hide_banner -version >/dev/null 2>&1 || gagal "FFmpeg di dalam Leura.app tidak bisa dijalankan."
oke "FFmpeg di dalam Leura.app"
if [ -x kamera-sony/bin/sony-helper ]; then
  "$RES/kamera-sony/bin/sony-helper" </dev/null | head -1 | grep -q '"siap"' || gagal "Program kamera Sony di dalam Leura.app tidak bisa dijalankan."
  [ -f "$RES/kamera-sony/bin/Contents/Frameworks/CrAdapter/libCr_PTP_USB.dylib" ] || gagal "Pustaka USB Sony tidak ikut ke Leura.app."
  oke "Program kamera Sony di dalam Leura.app"
fi
[ -f "$RES/THIRD-PARTY-NOTICES.txt" ] && oke "Lisensi pihak ketiga"
V=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")
[ "$V" = "$VERSI" ] && oke "Versi $V"
codesign --verify --deep "$APP" >/dev/null 2>&1 && oke "Tanda tangan (ad-hoc) utuh" || awas "Tanda tangan tidak lengkap — kalau macOS menolak membuka, klik kanan Leura.app → Open."
DMG=$(ls dist/*.dmg 2>/dev/null | head -1)

printf '\n✓ Selesai\n'
printf '  Installer : %s (%s)\n' "$DMG" "$(du -h "$DMG" | cut -f1)"
printf '  Aplikasi  : %s\n\n' "$APP"
printf 'Memasang:\n'
printf '  1. Tutup Leura (npm start) kalau sedang jalan.\n'
printf '  2. Buka %s, seret Leura ke folder Applications.\n' "$(basename "$DMG")"
printf '  3. Buka Leura dari Applications. Pertama kali: izinkan Kamera & Mikrofon.\n'
printf '     Kalau macOS bilang aplikasi tidak bisa dibuka: klik kanan Leura → Open.\n'
printf '  Data acara (couple, rekaman, pengaturan, QR) tetap sama seperti saat npm start.\n\n'
