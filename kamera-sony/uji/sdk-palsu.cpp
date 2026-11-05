/* SDK Sony palsu — HANYA untuk menguji sony-helper.cpp tanpa kamera (di Linux/Mac).
   Meniru perilaku yang dipakai helper: sambung, properti, live view, jepret + post view,
   rekam video ke "kartu", dan salin file dari kartu.
   Skenario lewat variabel lingkungan SONY_PALSU:
     (kosong)      kamera ada & normal
     tanpa-kamera  tidak ada kamera tersambung
     foto-hilang   kamera tidak memotret sama sekali
     tidak-fokus   kamera gagal fokus dan tidak memotret
     postview-mati foto tersimpan di kartu, tapi post view tidak pernah dikirim
     putus         kamera terputus 1,5 detik setelah tersambung */
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include "CameraRemote_SDK.h"
#include "IDeviceCallback.h"

namespace SCRSDK {
// ---- kelas data ----
CrDeviceProperty::CrDeviceProperty() : code(0), valueType(CrDataType_UInt32), enableFlag(CrPropertyEnableFlag(1)),
  variableFlag(CrPropertyVariableFlag(1)), currentValue(0), currentStr(nullptr), valuesSize(0), values(nullptr), getSetValuesSize(0), getSetValues(nullptr) {}
CrDeviceProperty::~CrDeviceProperty() {}
CrDeviceProperty::CrDeviceProperty(const CrDeviceProperty& r) { *this = r; }
CrDeviceProperty& CrDeviceProperty::operator=(const CrDeviceProperty& r) {
  code = r.code; valueType = r.valueType; enableFlag = r.enableFlag; variableFlag = r.variableFlag;
  currentValue = r.currentValue; currentStr = nullptr; valuesSize = 0; values = nullptr; getSetValuesSize = 0; getSetValues = nullptr;
  return *this;
}
void CrDeviceProperty::SetCode(CrInt32u c) { code = c; }
CrInt32u CrDeviceProperty::GetCode() const { return code; }
void CrDeviceProperty::SetCurrentValue(CrInt64u v) { currentValue = v; }
CrInt64u CrDeviceProperty::GetCurrentValue() const { return currentValue; }
CrImageInfo::CrImageInfo() : width(640), height(424), bufferSize(0) {}
CrImageInfo::~CrImageInfo() {}
CrInt32u CrImageInfo::GetBufferSize() const { return bufferSize; }
CrImageDataBlock::CrImageDataBlock() : frameNo(0), size(0), pData(nullptr), imageSize(0), timeCode(0) {}
CrImageDataBlock::~CrImageDataBlock() {}
void CrImageDataBlock::SetSize(CrInt32u s) { size = s; }
CrInt32u CrImageDataBlock::GetSize() const { return size; }
void CrImageDataBlock::SetData(CrInt8u* d) { pData = d; }
CrInt32u CrImageDataBlock::GetImageSize() const { return imageSize; }
CrInt8u* CrImageDataBlock::GetImageData() const { return pData; }
CrCaptureDate::CrCaptureDate() : year(2026), month(11), day(8), hour(0), minute(0), sec(0), msec(0) {}
CrCaptureDate::~CrCaptureDate() {}
CrContentsFile::CrContentsFile() : fileId(1), filePathLength(0), filePath(nullptr), fileFormat(CrContentsFile_FileFormat_Mp4), fileSize(0) {}
CrContentsFile::~CrContentsFile() {}
CrContentsInfo::CrContentsInfo() : contentId(0), filesNum(0), files(nullptr) {}
CrContentsInfo::~CrContentsInfo() {}
}  // namespace SCRSDK

using namespace SCRSDK;
namespace {
std::string skenario() { const char* s = getenv("SONY_PALSU"); return s ? s : ""; }
IDeviceCallback* cb = nullptr;
std::string folder = ".";
std::atomic<bool> merekam{false};
std::mutex mx;
std::vector<std::pair<uint32_t, std::string>> video = {{1, "C0001.MP4"}};   // isi "kartu"
std::vector<std::pair<uint32_t, std::string>> fotoKartu = {{900, "DSC00900.JPG"}};
uint32_t nomorFile = 1;
const unsigned char JPG[] = {0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 'J', 'F', 'I', 'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xFF, 0xD9};
void tulis(const std::string& f, const std::string& isi) { std::ofstream o(f, std::ios::binary); o << isi; }
void nanti(int ms, std::function<void()> fn) { std::thread([=] { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); fn(); }).detach(); }

struct InfoPalsu : ICrCameraObjectInfo {
  CrChar nama[16] = "ILCE-6700", tipe[8] = "USB", kosong[1] = "";
  CrInt8u id[4] = {1, 2, 3, 4};
  void Release() override {}
  CrChar* GetName() const override { return (CrChar*)nama; }
  CrInt32u GetNameSize() const override { return 9; }
  CrChar* GetModel() const override { return (CrChar*)nama; }
  CrInt32u GetModelSize() const override { return 9; }
  CrInt16 GetUsbPid() const override { return 0; }
  CrInt8u* GetId() const override { return (CrInt8u*)id; }
  CrInt32u GetIdSize() const override { return 4; }
  CrInt32u GetIdType() const override { return 0; }
  CrInt32u GetConnectionStatus() const override { return 0; }
  CrChar* GetConnectionTypeName() const override { return (CrChar*)tipe; }
  CrChar* GetAdaptorName() const override { return (CrChar*)kosong; }
  CrChar* GetGuid() const override { return (CrChar*)kosong; }
  CrChar* GetPairingNecessity() const override { return (CrChar*)kosong; }
  CrInt16u GetAuthenticationState() const override { return 0; }
  CrInt32u GetSSHsupport() const override { return 0; }
  CrInt32u GetIPAddress() const override { return 0; }
  CrChar* GetIPAddressChar() const override { return (CrChar*)kosong; }
  CrInt32u GetIPAddressCharSize() const override { return 0; }
  CrInt8u* GetMACAddress() const override { return nullptr; }
  CrInt32u GetMACAddressSize() const override { return 0; }
  CrChar* GetMACAddressChar() const override { return (CrChar*)kosong; }
  CrInt32u GetMACAddressCharSize() const override { return 0; }
} infoPalsu;
struct DaftarPalsu : ICrEnumCameraObjectInfo {
  CrInt32u GetCount() const override { return 1; }
  const ICrCameraObjectInfo* GetCameraObjectInfo(CrInt32u) const override { return &infoPalsu; }
  void Release() override {}
} daftarPalsu;
}  // namespace

namespace SCRSDK {
extern "C" {
bool Init(CrInt32u) { return true; }
bool Release() { return true; }
CrError EnumCameraObjects(ICrEnumCameraObjectInfo** p, CrInt8u) {
  if (skenario() == "tanpa-kamera") { *p = nullptr; return CrError_Adaptor_InvalidProperty; }
  *p = &daftarPalsu; return CrError_None;
}
CrError Connect(ICrCameraObjectInfo*, IDeviceCallback* c, CrDeviceHandle* h, CrSdkControlMode, CrReconnectingSet,
                const char*, const char*, const char*, CrInt32u, const CrInt16u*) {
  cb = c; *h = 42;
  nanti(100, [] { cb->OnConnected(DeviceConnectionVersioin(0)); });
  if (skenario() == "putus") nanti(1500, [] { cb->OnDisconnected(0x8000); });
  return CrError_None;
}
CrError Disconnect(CrDeviceHandle) { nanti(50, [] { cb->OnDisconnected(0); }); return CrError_None; }
CrError ReleaseDevice(CrDeviceHandle) { return CrError_None; }
CrError GetSelectDeviceProperties(CrDeviceHandle, CrInt32u, CrInt32u* codes, CrDeviceProperty** props, CrInt32* n) {
  auto* p = new CrDeviceProperty[1];
  p[0].SetCode(codes[0]);
  int64_t v = 0;
  switch (codes[0]) {
    case CrDeviceProperty_BatteryRemain: v = 87; break;
    case CrDeviceProperty_MediaSLOT1_RemainingTime: v = 7800; break;
    case CrDeviceProperty_MediaSLOT1_RemainingNumber: v = 2400; break;
    case CrDeviceProperty_RecordingState: v = merekam ? CrMovie_Recording_State_Recording : CrMovie_Recording_State_Not_Recording; break;
    case CrDeviceProperty_FocusIndication: v = skenario() == "tidak-fokus" ? CrFocusIndicator_NotFocused_AF_S : CrFocusIndicator_Focused_AF_S; break;
  }
  p[0].SetCurrentValue(v);
  *props = p; *n = 1; return CrError_None;
}
CrError ReleaseDeviceProperties(CrDeviceHandle, CrDeviceProperty* p) { delete[] p; return CrError_None; }
CrError SetDeviceProperty(CrDeviceHandle, CrDeviceProperty*) { return CrError_None; }
CrError SetDeviceSetting(CrDeviceHandle, CrInt32u, CrInt32u) { return CrError_None; }
CrError SetSaveInfo(CrDeviceHandle, CrChar* path, CrChar*, CrInt32) { folder = path; return CrError_None; }
CrError GetLiveViewImageInfo(CrDeviceHandle, CrImageInfo* info) {
  *(CrInt32u*)((char*)info + 2 * sizeof(CrInt32u)) = sizeof(JPG); return CrError_None;
}
CrError GetLiveViewImage(CrDeviceHandle, CrImageDataBlock* b) {
  memcpy(b->GetImageData(), JPG, sizeof(JPG));
  // imageSize ada setelah frameNo, size, pData
  struct Tata { CrInt32u frameNo, size; CrInt8u* pData; CrInt32u imageSize, timeCode; };
  ((Tata*)b)->imageSize = sizeof(JPG);
  return CrError_None;
}
CrError SendCommand(CrDeviceHandle, CrInt32u cmd, CrCommandParam p) {
  if (cmd == CrCommandId_Release && p == CrCommandParam_Up) {
    if (skenario() == "foto-hilang" || skenario() == "tidak-fokus") return CrError_None;
    nanti(200, [] {                        // foto tersimpan di kartu
      std::lock_guard<std::mutex> l(mx);
      fotoKartu.push_back({1000 + (uint32_t)fotoKartu.size(), "DSC0" + std::to_string(1000 + fotoKartu.size()) + ".JPG"});
    });
    if (skenario() == "postview-mati") return CrError_None;
    nanti(300, [] {
      std::string f = folder + "/DSC0" + std::to_string(++nomorFile) + ".JPG";
      tulis(f, std::string((const char*)JPG, sizeof(JPG)));
      std::vector<CrChar> buf(f.begin(), f.end()); buf.push_back(0);
      cb->OnCompleteDownload(buf.data(), 0);
    });
  }
  if (cmd == CrCommandId_MovieRecord && p == CrCommandParam_Down) nanti(300, [] { merekam = true; });
  if (cmd == CrCommandId_MovieRecord && p == CrCommandParam_Up) nanti(300, [] {
    merekam = false;
    nanti(700, [] {
      std::lock_guard<std::mutex> l(mx);
      uint32_t n = (uint32_t)video.size() + 1;
      char nama[16]; snprintf(nama, sizeof nama, "C%04u.MP4", n);
      video.push_back({n, nama});
    });
  });
  return CrError_None;
}
CrError GetRemoteTransferCapturedDateList(CrDeviceHandle, CrSlotNumber, CrCaptureDate** list, CrInt32u* n) {
  *list = new CrCaptureDate[2]; (*list)[0].day = 1; *n = 2; return CrError_None;
}
CrError ReleaseRemoteTransferCapturedDateList(CrDeviceHandle, CrCaptureDate* l) { delete[] l; return CrError_None; }
CrError GetRemoteTransferContentsInfoList(CrDeviceHandle, CrSlotNumber, CrGetContentsInfoListType, CrCaptureDate* tgl, CrInt32u,
                                          CrContentsInfo** out, CrInt32u* n) {
  if (tgl->day != 8) { *out = nullptr; *n = 0; return CrError_None; }   // helper harus memilih tanggal terbaru
  std::lock_guard<std::mutex> l(mx);
  const size_t nf = fotoKartu.size();
  *out = new CrContentsInfo[video.size() + nf];
  for (size_t i = 0; i < nf; i++) {          // foto JPG (diabaikan saat mencari video)
    CrContentsInfo& foto = (*out)[i];
    foto.contentId = fotoKartu[i].first; foto.filesNum = 1; foto.files = new CrContentsFile[1];
    foto.files[0].fileFormat = CrContentsFile_FileFormat_Jpeg;
    foto.files[0].filePath = (CrInt8*)strdup(fotoKartu[i].second.c_str()); foto.files[0].filePathLength = (CrInt32u)fotoKartu[i].second.size() + 1;
  }
  for (size_t i = 0; i < video.size(); i++) {
    CrContentsInfo& c = (*out)[i + nf];
    c.contentId = video[i].first; c.filesNum = 1; c.files = new CrContentsFile[1];
    c.files[0].fileId = 1; c.files[0].fileFormat = CrContentsFile_FileFormat_Mp4;
    c.files[0].filePath = (CrInt8*)strdup(video[i].second.c_str());
    c.files[0].filePathLength = (CrInt32u)video[i].second.size() + 1; c.files[0].fileSize = 52428800;
  }
  *n = (CrInt32u)(video.size() + nf); return CrError_None;
}
CrError ReleaseRemoteTransferContentsInfoList(CrDeviceHandle, CrContentsInfo* l) { delete[] l; return CrError_None; }
CrError GetRemoteTransferContentsDataFile(CrDeviceHandle, CrSlotNumber, CrInt32u contentId, CrInt32u, CrInt32u, CrChar* path, CrChar*) {
  std::string dir = path ? path : folder;
  std::string nama;
  bool jpg = false;
  { std::lock_guard<std::mutex> l(mx);
    for (auto& v : video) if (v.first == contentId) nama = v.second;
    for (auto& v : fotoKartu) if (v.first == contentId) { nama = v.second; jpg = true; } }
  if (nama.empty()) return CrError_Generic_InvalidParameter;
  nanti(100, [] { cb->OnNotifyRemoteTransferResult(CrNotify_RemoteTransfer_InProgress, 50, (CrChar*)""); });
  nanti(400, [=] {
    std::string f = dir + "/" + nama;
    tulis(f, jpg ? std::string((const char*)JPG, sizeof(JPG)) : "video palsu " + nama);
    std::vector<CrChar> buf(f.begin(), f.end()); buf.push_back(0);
    cb->OnNotifyRemoteTransferResult(CrNotify_RemoteTransfer_Result_OK, 100, buf.data());
  });
  return CrError_None;
}
}  // extern "C"
}  // namespace SCRSDK
