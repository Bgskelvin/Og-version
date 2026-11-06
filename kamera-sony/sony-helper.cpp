/* =====================================================================
   sony-helper.cpp — program penghubung antara aplikasi dan kamera Sony
   (Camera Remote SDK v2.02, mode Remote Transfer lewat USB).

   Dijalankan oleh main/kamera-sony.js sebagai proses terpisah, jadi kalau
   kamera atau SDK bermasalah, aplikasi utamanya tidak ikut berhenti.

   Perintah masuk lewat stdin, satu baris per perintah, dipisah TAB:
       <id> TAB <perintah> TAB <arg1> TAB <arg2> ...
   Jawaban & kabar keluar lewat stdout, satu baris JSON per pesan:
       {"id":7,"ok":true,...}          jawaban perintah 7
       {"ev":"terputus"}               kabar dari kamera

   Perintah:
       sambung <folderSementara>      cari kamera USB, sambungkan, siapkan pengaturan
       putus                          putuskan kamera
       status                         baterai, kartu, status rekam
       lv                             satu gambar live view (JPEG base64)
       foto <folder>                  jepret, tunggu foto masuk ke <folder>
       rekam-mulai                    mulai rekam video (ke kartu SD)
       rekam-stop                     berhenti rekam, cari file video barunya
       unduh <slot> <contentId> <fileId> <folder>
                                      salin file dari kartu ke <folder>
                                      (jalan di belakang; selesai = kabar "unduh-selesai")
       mode [foto|video]              tanpa argumen: baca mode kamera (ExposureProgramMode)
                                      foto/video: pindah mode dari komputer (tanpa memutar tombol
                                      kamera; butuh "Position Key" = PC Remote, dipasang saat sambung)
       keluar
   ===================================================================== */
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <functional>
#include <tuple>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "CameraRemote_SDK.h"
#include "CrDeviceProperty.h"
#include "IDeviceCallback.h"

namespace SDK = SCRSDK;
using Clock = std::chrono::steady_clock;

/* ---------------- Keluaran (aman dipanggil dari banyak thread) ---------------- */
static std::mutex g_outMutex;
static void kirim(const std::string& json) {
  std::lock_guard<std::mutex> lock(g_outMutex);
  fwrite(json.data(), 1, json.size(), stdout);
  fputc('\n', stdout);
  fflush(stdout);
}
static std::string esc(const std::string& s) {
  std::string o;
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += (char)c; }
    else if (c == '\n') o += "\\n";
    else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += (char)c;
  }
  return o;
}
static std::string hex(uint32_t v) { char b[16]; snprintf(b, sizeof b, "0x%x", v); return b; }
static void jawabOk(long id, const std::string& isi = "") {
  kirim("{\"id\":" + std::to_string(id) + ",\"ok\":true" + (isi.empty() ? "" : "," + isi) + "}");
}
static void jawabGagal(long id, const std::string& pesan, uint32_t kode = 0) {
  kirim("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"error\":\"" + esc(pesan) + "\"" +
        (kode ? ",\"kode\":\"" + hex(kode) + "\"" : "") + "}");
}
static void kabar(const std::string& ev, const std::string& isi = "") {
  kirim("{\"ev\":\"" + ev + "\"" + (isi.empty() ? "" : "," + isi) + "}");
}

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
static std::string base64(const uint8_t* d, size_t n) {
  std::string o; o.reserve((n + 2) / 3 * 4);
  size_t i = 0;
  for (; i + 2 < n; i += 3) {
    uint32_t v = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    o += B64[v >> 18]; o += B64[(v >> 12) & 63]; o += B64[(v >> 6) & 63]; o += B64[v & 63];
  }
  if (i < n) {
    uint32_t v = d[i] << 16; if (i + 1 < n) v |= d[i + 1] << 8;
    o += B64[v >> 18]; o += B64[(v >> 12) & 63];
    o += (i + 1 < n) ? B64[(v >> 6) & 63] : '='; o += '=';
  }
  return o;
}

/* ---------------- Status bersama (diisi oleh callback SDK) ---------------- */
static std::mutex g_mx;
static std::condition_variable g_cv;
static SDK::CrDeviceHandle g_dev = 0;
static bool g_sdkSiap = false;
static std::atomic<bool> g_tersambung{false};
static std::atomic<bool> g_perluSetel{false};        // setelah sambung ulang, pengaturan harus dipasang lagi
static std::string g_model;
// tunggu "tersambung"
static int g_hasilSambung = 0;                        // 0 = menunggu, 1 = ok, -1 = gagal
static uint32_t g_kodeSambung = 0;
// tunggu foto
static bool g_tungguFoto = false;
static std::string g_fileFoto;
// unduh file (jalan di belakang). Job negatif = unduhan internal (foto dari kartu), ditunggu di sini.
static std::atomic<long> g_unduhJob{0};
static long g_unduhSelesai = 0;          // job yang baru selesai
static bool g_unduhOk = false;
static std::string g_unduhFile;

static std::string teks(const CrChar* s) { return s ? std::string(s) : std::string(); }

class Panggilan : public SDK::IDeviceCallback {
 public:
  void OnConnected(SDK::DeviceConnectionVersioin) override {
    bool ulang;
    {
      std::lock_guard<std::mutex> l(g_mx);
      ulang = g_hasilSambung != 0;
      g_hasilSambung = 1;
    }
    g_tersambung = true;
    g_cv.notify_all();
    if (ulang) { g_perluSetel = true; kabar("tersambung"); }
  }
  void OnError(CrInt32u e) override {
    { std::lock_guard<std::mutex> l(g_mx); if (g_hasilSambung == 0) { g_hasilSambung = -1; g_kodeSambung = e; } }
    g_cv.notify_all();
    kabar("error", "\"kode\":\"" + hex(e) + "\"");
  }
  void OnDisconnected(CrInt32u e) override {
    g_tersambung = false;
    g_cv.notify_all();
    kabar("terputus", "\"kode\":\"" + hex(e) + "\"");
  }
  void OnWarning(CrInt32u w) override {
    if (w == SDK::CrWarning_Connect_Reconnecting) { g_tersambung = false; kabar("menyambung-ulang"); return; }
    if (w == SDK::CrWarning_Connect_Reconnected) { g_tersambung = true; g_perluSetel = true; kabar("tersambung"); return; }
    kabar("peringatan", "\"kode\":\"" + hex(w) + "\"");
  }
  // Foto hasil jepretan sudah tersimpan di komputer (post view, mode Legacy)
  void OnCompleteDownload(CrChar* filename, CrInt32u) override {
    std::string f = teks(filename);
    {
      std::lock_guard<std::mutex> l(g_mx);
      if (g_tungguFoto) { g_fileFoto = f; g_tungguFoto = false; }
    }
    g_cv.notify_all();
    kabar("foto-masuk", "\"file\":\"" + esc(f) + "\"");
  }
  // Hasil salin file dari kartu (mode Remote Transfer)
  void OnNotifyRemoteTransferResult(CrInt32u notify, CrInt32u per, CrChar* filename) override {
    long job = g_unduhJob.load();
    if (notify == SDK::CrNotify_RemoteTransfer_InProgress) {
      kabar("unduh-progres", "\"job\":" + std::to_string(job) + ",\"persen\":" + std::to_string(per));
      return;
    }
    if (!job) return;
    bool ok = notify == SDK::CrNotify_RemoteTransfer_Result_OK;
    bool gagal = notify == SDK::CrNotify_RemoteTransfer_Result_NG || notify == SDK::CrNotify_RemoteTransfer_Result_DeviceBusy ||
                 notify == SDK::CrNotify_RemoteTransfer_Control_Canceled || notify == SDK::CrNotify_RemoteTransfer_Control_Stopped;
    if (!ok && !gagal) return;
    g_unduhJob = 0;
    { std::lock_guard<std::mutex> l(g_mx); g_unduhSelesai = job; g_unduhOk = ok; g_unduhFile = ok ? teks(filename) : hex(notify); }
    g_cv.notify_all();
    if (job < 0) return;                  // unduhan internal: hasilnya dipakai perintah foto
    if (ok) kabar("unduh-selesai", "\"job\":" + std::to_string(job) + ",\"file\":\"" + esc(teks(filename)) + "\"");
    else kabar("unduh-gagal", "\"job\":" + std::to_string(job) + ",\"kode\":\"" + hex(notify) + "\"");
  }
  void OnNotifyRemoteTransferResult(CrInt32u, CrInt32u, CrInt8u*, CrInt64u) override {}
  void OnNotifyRemoteTransferContentsListChanged(CrInt32u notify, CrInt32u slot, CrInt32u n) override {
    kabar("isi-kartu-berubah", "\"slot\":" + std::to_string(slot) + ",\"jumlah\":" + std::to_string(n));
  }
};
static Panggilan g_cb;

/* ---------------- Properti kamera ---------------- */
static bool bacaProp(uint32_t kode, int64_t& nilai) {
  CrInt32 n = 0;
  SDK::CrDeviceProperty* daftar = nullptr;
  CrInt32u k = kode;
  if (SDK::GetSelectDeviceProperties(g_dev, 1, &k, &daftar, &n) || !daftar || n < 1) {
    if (daftar) SDK::ReleaseDeviceProperties(g_dev, daftar);
    return false;
  }
  nilai = (int64_t)daftar[0].GetCurrentValue();
  SDK::ReleaseDeviceProperties(g_dev, daftar);
  return true;
}
static uint32_t tulisProp(uint32_t kode, uint64_t nilai) {
  CrInt32 n = 0;
  SDK::CrDeviceProperty* daftar = nullptr;
  CrInt32u k = kode;
  SDK::CrError e = SDK::GetSelectDeviceProperties(g_dev, 1, &k, &daftar, &n);
  if (e || !daftar || n < 1) { if (daftar) SDK::ReleaseDeviceProperties(g_dev, daftar); return e ? e : 1; }
  SDK::CrDeviceProperty p = daftar[0];
  SDK::ReleaseDeviceProperties(g_dev, daftar);
  if ((uint64_t)p.GetCurrentValue() == nilai) return 0;
  p.SetCurrentValue(nilai);
  return SDK::SetDeviceProperty(g_dev, &p);
}

// Pengaturan yang dibutuhkan booth. Dipasang setiap kali tersambung (termasuk sambung ulang),
// karena SDK mengembalikan post view ke "mati" setiap kali tersambung ulang.
static std::string setelKamera() {
  std::string catatan;
  auto cek = [&](const char* nama, uint32_t e) { if (e) catatan += std::string(catatan.empty() ? "" : ", ") + nama + "=" + hex(e); };
  cek("liveview", SDK::SetDeviceSetting(g_dev, SDK::Setting_Key_EnableLiveView, SDK::CrDeviceSetting_Enable));
  cek("postview", SDK::SetDeviceSetting(g_dev, SDK::Setting_Key_EnablePostView, SDK::CrDeviceSetting_Enable));
  cek("postviewType", SDK::SetDeviceSetting(g_dev, SDK::Setting_Key_PostViewTransferringType, SDK::CrPostViewTransferring_Legacy));
  cek("prioritas", tulisProp(SDK::CrDeviceProperty_PriorityKeySettings, SDK::CrPriorityKey_PCRemote));
  // Foto disimpan di komputer DAN di kartu SD (cadangan)
  cek("simpanFoto", tulisProp(SDK::CrDeviceProperty_StillImageStoreDestination, SDK::CrStillImageStoreDestination_HostPCAndMemoryCard));
  g_perluSetel = false;
  return catatan;
}
static void setelJikaPerlu() { if (g_perluSetel && g_tersambung) setelKamera(); }

/* ---------------- Isi kartu: daftar file (video MP4 / foto JPEG) ---------------- */
struct FileKartu { uint32_t slot, contentId, fileId; std::string nama; uint64_t ukuran; };

static std::vector<FileKartu> daftarFile(uint32_t slot, SDK::CrContentsFile_FileFormat format) {
  std::vector<FileKartu> out;
  SDK::CrCaptureDate* tanggal = nullptr;
  CrInt32u nTanggal = 0;
  if (SDK::GetRemoteTransferCapturedDateList(g_dev, (SDK::CrSlotNumber)slot, &tanggal, &nTanggal) || !tanggal || !nTanggal) {
    if (tanggal) SDK::ReleaseRemoteTransferCapturedDateList(g_dev, tanggal);
    return out;
  }
  // tanggal paling baru = hari ini (video yang baru direkam ada di sini)
  size_t terbaru = 0;
  for (size_t i = 1; i < nTanggal; i++) {
    auto& a = tanggal[i]; auto& b = tanggal[terbaru];
    if (std::make_tuple(a.year, a.month, a.day) > std::make_tuple(b.year, b.month, b.day)) terbaru = i;
  }
  SDK::CrContentsInfo* isi = nullptr;
  CrInt32u nIsi = 0;
  if (!SDK::GetRemoteTransferContentsInfoList(g_dev, (SDK::CrSlotNumber)slot, SDK::CrGetContentsInfoListType_Range_Day,
                                              &tanggal[terbaru], 0, &isi, &nIsi) && isi) {
    for (CrInt32u i = 0; i < nIsi; i++)
      for (CrInt32u f = 0; f < isi[i].filesNum; f++) {
        auto& fl = isi[i].files[f];
        if (fl.fileFormat != format) continue;
        out.push_back({slot, isi[i].contentId, fl.fileId,
                       fl.filePath ? std::string((const char*)fl.filePath, fl.filePathLength ? strnlen((const char*)fl.filePath, fl.filePathLength) : strlen((const char*)fl.filePath)) : "",
                       fl.fileSize});
      }
    SDK::ReleaseRemoteTransferContentsInfoList(g_dev, isi);
  }
  SDK::ReleaseRemoteTransferCapturedDateList(g_dev, tanggal);
  return out;
}
static std::vector<FileKartu> daftarVideo(uint32_t slot) { return daftarFile(slot, SDK::CrContentsFile_FileFormat_Mp4); }
static std::set<uint64_t> g_videoSebelum;   // video yang sudah ada sebelum rekam dimulai
static uint64_t kunci(const FileKartu& f) { return ((uint64_t)f.slot << 48) | ((uint64_t)f.contentId << 16) | f.fileId; }

/* ---------------- Perintah ---------------- */
static bool tunggu(int ms, const std::function<bool()>& selesai) {
  std::unique_lock<std::mutex> l(g_mx);
  return g_cv.wait_for(l, std::chrono::milliseconds(ms), selesai);
}

static void cmdSambung(long id, const std::vector<std::string>& a) {
  if (g_tersambung && g_dev) { setelJikaPerlu(); return jawabOk(id, "\"model\":\"" + esc(g_model) + "\""); }
  if (!g_sdkSiap) {
    if (!SDK::Init()) return jawabGagal(id, "SDK Sony gagal dimulai");
    g_sdkSiap = true;
  }
  if (g_dev) { SDK::ReleaseDevice(g_dev); g_dev = 0; }
  SDK::ICrEnumCameraObjectInfo* daftar = nullptr;
  SDK::CrError e = SDK::EnumCameraObjects(&daftar, 3);
  if (e || !daftar || daftar->GetCount() == 0) {
    if (daftar) daftar->Release();
    return jawabGagal(id, "Kamera Sony tidak ditemukan. Cek kabel USB, kamera menyala, dan mode USB = PC Remote.", e);
  }
  // Pilih kamera USB pertama
  const SDK::ICrCameraObjectInfo* info = nullptr;
  for (CrInt32u i = 0; i < daftar->GetCount() && !info; i++) {
    auto* x = daftar->GetCameraObjectInfo(i);
    if (teks(x->GetConnectionTypeName()) != "IP") info = x;
  }
  if (!info) info = daftar->GetCameraObjectInfo(0);
  g_model = teks(info->GetModel());
  { std::lock_guard<std::mutex> l(g_mx); g_hasilSambung = 0; g_kodeSambung = 0; }
  e = SDK::Connect(const_cast<SDK::ICrCameraObjectInfo*>(info), &g_cb, &g_dev,
                   SDK::CrSdkControlMode_RemoteTransfer, SDK::CrReconnecting_ON);
  daftar->Release();
  if (e) return jawabGagal(id, "Gagal menyambung ke kamera", e);
  if (!tunggu(15000, [] { return g_hasilSambung != 0; })) return jawabGagal(id, "Kamera tidak menjawab saat disambungkan");
  if (g_hasilSambung < 0) return jawabGagal(id, "Kamera menolak sambungan. Pastikan mode USB kamera = PC Remote.", g_kodeSambung);
  if (a.size() > 0 && !a[0].empty()) SDK::SetSaveInfo(g_dev, const_cast<CrChar*>(a[0].c_str()), const_cast<CrChar*>(""), -1);
  std::this_thread::sleep_for(std::chrono::milliseconds(800));   // beri waktu kamera mengirim daftar properti
  std::string catatan = setelKamera();
  jawabOk(id, "\"model\":\"" + esc(g_model) + "\"" + (catatan.empty() ? "" : ",\"catatan\":\"" + esc(catatan) + "\""));
}

static void cmdPutus(long id) {
  if (g_dev) {
    if (g_tersambung) { SDK::Disconnect(g_dev); tunggu(3000, [] { return !g_tersambung.load(); }); }
    SDK::ReleaseDevice(g_dev); g_dev = 0;
  }
  g_tersambung = false;
  jawabOk(id);
}

/* ---------------- Mode kamera: foto / video ---------------- */
// Baca properti beserta "bisa diubah?" dan daftar pilihan nilainya (seperti contoh resmi Sony)
static bool bacaPropLengkap(uint32_t kode, uint64_t& nilai, bool& bisaUbah, std::vector<uint32_t>& pilihan) {
  CrInt32 n = 0;
  SDK::CrDeviceProperty* daftar = nullptr;
  CrInt32u k = kode;
  if (SDK::GetSelectDeviceProperties(g_dev, 1, &k, &daftar, &n) || !daftar || n < 1) {
    if (daftar) SDK::ReleaseDeviceProperties(g_dev, daftar);
    return false;
  }
  nilai = daftar[0].GetCurrentValue();
  bisaUbah = daftar[0].IsSetEnableCurrentValue();
  pilihan.clear();
  CrInt32u jml = daftar[0].GetValueSize() / sizeof(uint32_t);
  const CrInt8u* buf = daftar[0].GetValues();
  for (CrInt32u i = 0; buf && i < jml; i++) { uint32_t v; std::memcpy(&v, buf + i * sizeof(uint32_t), sizeof v); pilihan.push_back(v); }
  SDK::ReleaseDeviceProperties(g_dev, daftar);
  return true;
}
// Mode foto/video terakhir yang dipakai kamera (mis. M untuk foto), supaya saat pindah balik
// kamera kembali ke pengaturan operator, bukan selalu ke P.
static uint32_t g_modeFoto = 0, g_modeVideo = 0;
static bool modeVideo(uint64_t m) { return m >= 0x8050 && m < 0x8100; }   // CrExposure_Movie_* (termasuk S&Q, interval)
static std::string jenisMode(uint64_t m) { return modeVideo(m) ? (m >= 0x8059 && m <= 0x805E ? "sq" : "video") : "foto"; }
static std::string jsonMode(uint64_t m, bool bisa, const std::vector<uint32_t>& pil) {
  std::string p;
  for (auto v : pil) p += (p.empty() ? "\"" : ",\"") + hex(v) + "\"";
  return "\"mode\":\"" + hex((uint32_t)m) + "\",\"jenis\":\"" + jenisMode(m) + "\",\"bisaUbah\":" + (bisa ? "true" : "false") + ",\"pilihan\":[" + p + "]";
}
static void cmdMode(long id, const std::vector<std::string>& a) {
  if (!g_tersambung) return jawabGagal(id, "Kamera belum tersambung");
  uint64_t m = 0; bool bisa = false; std::vector<uint32_t> pil;
  if (!bacaPropLengkap(SDK::CrDeviceProperty_ExposureProgramMode, m, bisa, pil)) return jawabGagal(id, "Mode kamera tidak bisa dibaca");
  auto ingat = [](uint64_t v) { if (jenisMode(v) == "video") g_modeVideo = (uint32_t)v; else if (jenisMode(v) == "foto") g_modeFoto = (uint32_t)v; };
  ingat(m);
  if (a.empty() || a[0].empty()) return jawabOk(id, jsonMode(m, bisa, pil));
  const bool keVideo = a[0] == "video";
  if (jenisMode(m) == (keVideo ? "video" : "foto")) return jawabOk(id, jsonMode(m, bisa, pil) + ",\"diubah\":false");
  // Pilih nilai tujuan: P (otomatis) kalau tersedia, kalau tidak nilai pertama dari jenis yang sama
  const uint32_t utama = keVideo ? (uint32_t)SDK::CrExposure_Movie_P : (uint32_t)SDK::CrExposure_P_Auto;
  uint32_t tujuan = keVideo ? g_modeVideo : g_modeFoto;      // mode terakhir yang dipakai (mis. M)
  if (!tujuan) for (auto v : pil) if (v == utama) tujuan = v;
  if (!tujuan) for (auto v : pil) if (modeVideo(v) == keVideo && jenisMode(v) != "sq") { tujuan = v; break; }
  if (!tujuan) tujuan = utama;     // daftar pilihan kosong: coba saja
  tulisProp(SDK::CrDeviceProperty_PriorityKeySettings, SDK::CrPriorityKey_PCRemote);
  // Seperti contoh resmi Sony: kirim, tunggu, baca lagi; ulangi sampai 5x
  SDK::CrError e = 0;
  int coba = 0;
  for (; coba < 5; coba++) {
    e = tulisProp(SDK::CrDeviceProperty_ExposureProgramMode, tujuan);
    std::this_thread::sleep_for(std::chrono::milliseconds(coba ? 1000 : 600));
    bacaPropLengkap(SDK::CrDeviceProperty_ExposureProgramMode, m, bisa, pil);
    if (m == tujuan || jenisMode(m) == (keVideo ? "video" : "foto")) break;
  }
  bool ok = jenisMode(m) == (keVideo ? "video" : "foto");
  if (ok) ingat(m);
  if (!ok) return jawabGagal(id, std::string("Kamera tidak mau pindah ke mode ") + (keVideo ? "video" : "foto") +
                             " (mode sekarang " + hex((uint32_t)m) + (bisa ? "" : ", terkunci tombol kamera") + ")", e);
  jawabOk(id, jsonMode(m, bisa, pil) + ",\"diubah\":true,\"coba\":" + std::to_string(coba + 1));
}

static void cmdStatus(long id) {
  if (!g_tersambung) return jawabOk(id, "\"tersambung\":false");
  setelJikaPerlu();
  int64_t baterai = -1, kartu = -1, sisaDetik = -1, sisaFoto = -1, rekam = -1;
  bacaProp(SDK::CrDeviceProperty_BatteryRemain, baterai);
  bacaProp(SDK::CrDeviceProperty_MediaSLOT1_Status, kartu);
  bacaProp(SDK::CrDeviceProperty_MediaSLOT1_RemainingTime, sisaDetik);
  bacaProp(SDK::CrDeviceProperty_MediaSLOT1_RemainingNumber, sisaFoto);
  bacaProp(SDK::CrDeviceProperty_RecordingState, rekam);
  jawabOk(id, "\"tersambung\":true,\"model\":\"" + esc(g_model) + "\",\"baterai\":" + std::to_string(baterai) +
              ",\"kartu\":" + std::to_string(kartu) + ",\"sisaDetik\":" + std::to_string(sisaDetik) +
              ",\"sisaFoto\":" + std::to_string(sisaFoto) + ",\"merekam\":" + (rekam == SDK::CrMovie_Recording_State_Recording ? "true" : "false") +
              ",\"mengunduh\":" + (g_unduhJob ? "true" : "false"));
}

static std::vector<uint8_t> g_lvBuf;
static void cmdLiveView(long id) {
  if (!g_tersambung) return jawabGagal(id, "Kamera belum tersambung");
  SDK::CrImageInfo info;
  SDK::CrError e = SDK::GetLiveViewImageInfo(g_dev, &info);
  if (e) return jawabGagal(id, "Live view belum siap", e);
  CrInt32u ukuran = info.GetBufferSize();
  if (!ukuran) return jawabGagal(id, "Live view belum siap");
  if (g_lvBuf.size() < ukuran) g_lvBuf.resize(ukuran);
  SDK::CrImageDataBlock blok;
  blok.SetData(g_lvBuf.data());
  blok.SetSize(ukuran);
  e = SDK::GetLiveViewImage(g_dev, &blok);
  if (e || !blok.GetImageSize()) return jawabGagal(id, "Live view belum siap", e);
  jawabOk(id, "\"jpg\":\"" + base64(blok.GetImageData(), blok.GetImageSize()) + "\"");
}

static uint32_t tekan(uint32_t perintah, int tahanMs = 35) {
  SDK::CrError e = SDK::SendCommand(g_dev, perintah, SDK::CrCommandParam_Down);
  if (e) return e;
  std::this_thread::sleep_for(std::chrono::milliseconds(tahanMs));
  return SDK::SendCommand(g_dev, perintah, SDK::CrCommandParam_Up);
}

// Tekan setengah (fokus) seperti tombol rana sungguhan. Kembali: teks hasil fokus (untuk laporan).
static std::string fokus() {
  if (tulisProp(SDK::CrDeviceProperty_S1, SDK::CrLockIndicator_Locked)) return "tidak-didukung";
  auto batas = Clock::now() + std::chrono::milliseconds(2500);
  while (Clock::now() < batas) {
    int64_t v = -1;
    if (bacaProp(SDK::CrDeviceProperty_FocusIndication, v)) {
      if (v == SDK::CrFocusIndicator_Focused_AF_S || v == SDK::CrFocusIndicator_Focused_AF_C) return "fokus";
      if (v == SDK::CrFocusIndicator_NotFocused_AF_S) return "tidak-fokus";
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(60));
  }
  return "waktu-habis";
}

// Salin satu file dari kartu ke folder, lalu tunggu sampai selesai
static bool unduhSekarang(const FileKartu& f, const std::string& folder, long job, std::string& hasil, int ms) {
  if (g_unduhJob) { hasil = "kartu sedang dipakai menyalin file lain"; return false; }
  g_unduhJob = job;
  SDK::CrError e = SDK::GetRemoteTransferContentsDataFile(g_dev, (SDK::CrSlotNumber)f.slot, f.contentId, f.fileId,
                                                          0x5000000, const_cast<CrChar*>(folder.c_str()), nullptr);
  if (e) { g_unduhJob = 0; hasil = "gagal mulai menyalin " + hex(e); return false; }
  if (!tunggu(ms, [job] { return g_unduhSelesai == job; })) { hasil = "menyalin terlalu lama"; return false; }
  hasil = g_unduhFile;
  return g_unduhOk;
}

/* Jepret:
   1. tekan setengah (fokus), tunggu fokus maks 2,5 detik
   2. tekan penuh, lalu lepas
   3. foto masuk lewat post view (cepat), ATAU kalau tidak datang, JPEG aslinya disalin dari kartu SD */
static void cmdFoto(long id, const std::vector<std::string>& a) {
  if (!g_tersambung) return jawabGagal(id, "Kamera belum tersambung");
  setelJikaPerlu();
  std::string folder = a.size() > 0 ? a[0] : "";
  if (!folder.empty()) SDK::SetSaveInfo(g_dev, const_cast<CrChar*>(folder.c_str()), const_cast<CrChar*>(""), -1);
  std::set<uint64_t> sebelum;
  for (auto& f : daftarFile(SDK::CrSlotNumber_Slot1, SDK::CrContentsFile_FileFormat_Jpeg)) sebelum.insert(kunci(f));
  { std::lock_guard<std::mutex> l(g_mx); g_tungguFoto = true; g_fileFoto.clear(); }
  auto t0 = Clock::now();
  std::string hasilFokus = fokus();
  SDK::CrError e = tekan(SDK::CrCommandId_Release, 100);
  tulisProp(SDK::CrDeviceProperty_S1, SDK::CrLockIndicator_Unlocked);
  if (e) { std::lock_guard<std::mutex> l(g_mx); g_tungguFoto = false; return jawabGagal(id, "Kamera menolak jepret (fokus: " + hasilFokus + ")", e); }
  auto selesai = [&](const std::string& file, const char* sumber) {
    long ms = (long)std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - t0).count();
    jawabOk(id, "\"file\":\"" + esc(file) + "\",\"ms\":" + std::to_string(ms) + ",\"sumber\":\"" + sumber + "\",\"fokus\":\"" + hasilFokus + "\"");
  };
  if (tunggu(4000, [] { return !g_tungguFoto; })) return selesai(g_fileFoto, "postview");
  { std::lock_guard<std::mutex> l(g_mx); g_tungguFoto = false; }
  // Post view tidak datang: cari JPEG baru di kartu dan salin aslinya
  auto batas = Clock::now() + std::chrono::seconds(8);
  while (Clock::now() < batas) {
    for (auto& f : daftarFile(SDK::CrSlotNumber_Slot1, SDK::CrContentsFile_FileFormat_Jpeg)) {
      if (sebelum.count(kunci(f))) continue;
      std::string hasil;
      if (unduhSekarang(f, folder, -id, hasil, 20000)) return selesai(hasil, "kartu");
      return jawabGagal(id, "Foto ada di kartu SD (" + f.nama + "), tapi gagal disalin: " + hasil);
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(400));
  }
  jawabGagal(id, hasilFokus == "tidak-fokus" || hasilFokus == "waktu-habis"
    ? "Kamera tidak memotret karena belum fokus (fokus: " + hasilFokus + "). Arahkan ke objek yang lebih terang/berkontras, atau pakai fokus manual (MF)."
    : "Kamera tidak memotret (fokus: " + hasilFokus + "). Cek mode kamera (harus mode foto, bukan video) dan kartu SD.");
}

static bool tungguRekam(bool merekam, int ms) {
  auto batas = Clock::now() + std::chrono::milliseconds(ms);
  while (Clock::now() < batas) {
    int64_t v = -1;
    if (bacaProp(SDK::CrDeviceProperty_RecordingState, v) && (v == SDK::CrMovie_Recording_State_Recording) == merekam) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(150));
  }
  return false;
}

static void cmdRekamMulai(long id) {
  if (!g_tersambung) return jawabGagal(id, "Kamera belum tersambung");
  setelJikaPerlu();
  g_videoSebelum.clear();
  for (auto& f : daftarVideo(SDK::CrSlotNumber_Slot1)) g_videoSebelum.insert(kunci(f));
  SDK::CrError e = SDK::SendCommand(g_dev, SDK::CrCommandId_MovieRecord, SDK::CrCommandParam_Down);
  if (e) return jawabGagal(id, "Kamera menolak mulai rekam", e);
  if (!tungguRekam(true, 4000)) return jawabGagal(id, "Kamera tidak mulai merekam. Cek kartu SD dan mode kamera.");
  jawabOk(id);
}

static void cmdRekamStop(long id) {
  if (!g_tersambung) return jawabGagal(id, "Kamera belum tersambung");
  SDK::CrError e = SDK::SendCommand(g_dev, SDK::CrCommandId_MovieRecord, SDK::CrCommandParam_Up);
  if (e) return jawabGagal(id, "Kamera menolak berhenti rekam", e);
  if (!tungguRekam(false, 10000)) return jawabGagal(id, "Kamera belum berhenti merekam");
  // Cari file video baru di kartu (perlu sebentar sampai kamera selesai menulis file)
  auto batas = Clock::now() + std::chrono::seconds(20);
  while (Clock::now() < batas) {
    for (auto& f : daftarVideo(SDK::CrSlotNumber_Slot1))
      if (!g_videoSebelum.count(kunci(f)))
        return jawabOk(id, "\"slot\":" + std::to_string(f.slot) + ",\"contentId\":" + std::to_string(f.contentId) +
                           ",\"fileId\":" + std::to_string(f.fileId) + ",\"nama\":\"" + esc(f.nama) +
                           "\",\"ukuran\":" + std::to_string(f.ukuran));
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
  }
  jawabGagal(id, "Video tersimpan di kartu SD, tapi file barunya tidak ditemukan");
}

static void cmdUnduh(long id, const std::vector<std::string>& a) {
  if (!g_tersambung) return jawabGagal(id, "Kamera belum tersambung");
  if (a.size() < 4) return jawabGagal(id, "Argumen unduh kurang");
  if (g_unduhJob) return jawabGagal(id, "Masih ada file yang sedang diunduh");
  uint32_t slot = (uint32_t)std::stoul(a[0]), contentId = (uint32_t)std::stoul(a[1]), fileId = (uint32_t)std::stoul(a[2]);
  g_unduhJob = id;
  SDK::CrError e = SDK::GetRemoteTransferContentsDataFile(g_dev, (SDK::CrSlotNumber)slot, contentId, fileId,
                                                          0x5000000 /* 80 MB per bagian */,
                                                          const_cast<CrChar*>(a[3].c_str()), nullptr);
  if (e) { g_unduhJob = 0; return jawabGagal(id, "Gagal mulai mengunduh dari kartu", e); }
  jawabOk(id, "\"job\":" + std::to_string(id));   // selesainya dikabarkan lewat "unduh-selesai"
}

static std::vector<std::string> pecah(const std::string& s) {
  std::vector<std::string> v; std::string x; std::istringstream in(s);
  while (std::getline(in, x, '\t')) v.push_back(x);
  return v;
}

int main() {
  std::ios::sync_with_stdio(false);
  kabar("siap", "\"versi\":1");
  std::string baris;
  while (std::getline(std::cin, baris)) {
    if (!baris.empty() && baris.back() == '\r') baris.pop_back();
    auto bag = pecah(baris);
    if (bag.size() < 2) continue;
    long id = 0;
    try { id = std::stol(bag[0]); } catch (...) { continue; }
    std::string cmd = bag[1];
    std::vector<std::string> arg(bag.begin() + 2, bag.end());
    try {
      if (cmd == "sambung") cmdSambung(id, arg);
      else if (cmd == "putus") cmdPutus(id);
      else if (cmd == "status") cmdStatus(id);
      else if (cmd == "lv") cmdLiveView(id);
      else if (cmd == "foto") cmdFoto(id, arg);
      else if (cmd == "rekam-mulai") cmdRekamMulai(id);
      else if (cmd == "rekam-stop") cmdRekamStop(id);
      else if (cmd == "unduh") cmdUnduh(id, arg);
      else if (cmd == "mode") cmdMode(id, arg);
      else if (cmd == "keluar") { jawabOk(id); break; }
      else jawabGagal(id, "Perintah tidak dikenal: " + cmd);
    } catch (const std::exception& ex) {
      jawabGagal(id, std::string("Kesalahan: ") + ex.what());
    }
  }
  if (g_dev) {
    if (g_tersambung) { SDK::Disconnect(g_dev); tunggu(3000, [] { return !g_tersambung.load(); }); }
    SDK::ReleaseDevice(g_dev);
  }
  if (g_sdkSiap) SDK::Release();
  return 0;
}
