#!/bin/bash
# =====================================================================
# build.sh — membuat program penghubung kamera Sony (khusus Mac).
# Jalankan dari folder proyek:   npm run build:sony
#
# Butuh:
#   - Xcode Command Line Tools   (pasang sekali: xcode-select --install)
#   - sdk/sony/SimpleCli.zip     (SDK Sony, tidak ikut Git karena berlisensi)
# Hasil:
#   kamera-sony/bin/sony-helper  + pustaka SDK di sebelahnya
# =====================================================================
set -e
cd "$(dirname "$0")"
PROYEK="$(cd .. && pwd)"
ZIP="$PROYEK/sdk/sony/SimpleCli.zip"
SDK=".sdk"
BIN="bin"

say() { printf '\n▶ %s\n' "$1"; }
gagal() { printf '\n✗ %s\n\n' "$1"; exit 1; }

[ "$(uname)" = "Darwin" ] || gagal "Program kamera Sony hanya dibuat di Mac."
xcode-select -p >/dev/null 2>&1 || gagal "Xcode Command Line Tools belum terpasang. Jalankan:  xcode-select --install  lalu ulangi."
command -v clang++ >/dev/null || gagal "clang++ tidak ditemukan. Pasang Xcode Command Line Tools:  xcode-select --install"
[ -f "$ZIP" ] || gagal "SDK Sony tidak ditemukan di sdk/sony/SimpleCli.zip"

say "Menyiapkan SDK Sony"
rm -rf "$SDK" && mkdir -p "$SDK"
unzip -q -o "$ZIP" 'app/CRSDK/*' 'external/crsdk/*' -d "$SDK"

say "Mengompilasi sony-helper (Apple Silicon + Intel)"
rm -rf "$BIN" && mkdir -p "$BIN"
clang++ -std=c++17 -O2 -arch arm64 -arch x86_64 -mmacosx-version-min=12.1 \
  -isystem "$SDK/app/CRSDK" sony-helper.cpp \
  -L "$SDK/external/crsdk" -lCr_Core \
  -Wl,-rpath,@executable_path \
  -o "$BIN/sony-helper"

say "Menyalin pustaka SDK"
# Susunan sama seperti contoh resmi Sony untuk Mac:
#   bin/libCr_Core.dylib, bin/libmonitor_protocol*.dylib
#   bin/Contents/Frameworks/CrAdapter/*.dylib
cp "$SDK"/external/crsdk/*.dylib "$BIN/"
mkdir -p "$BIN/Contents/Frameworks/CrAdapter"
cp "$SDK"/external/crsdk/CrAdapter/*.dylib "$BIN/Contents/Frameworks/CrAdapter/"
# File dari zip unduhan ditandai "karantina" oleh macOS dan bisa diblokir saat dimuat
xattr -dr com.apple.quarantine "$BIN" 2>/dev/null || true

say "Memeriksa hasil"
"$BIN/sony-helper" </dev/null | head -1 | grep -q '"siap"' || gagal "sony-helper dibuat tapi tidak bisa dijalankan."
rm -rf "$SDK"

printf '\n✓ Selesai: kamera-sony/bin/sony-helper\n'
printf '  Sambungkan kamera lalu jalankan:  npm run uji:sony\n\n'
