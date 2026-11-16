/* Fake Lumix SDK — ONLY for testing lumix-helper.cpp without a camera (Windows, developer computer).
   Built with:  npm run build:lumix -- --fake   →  kamera-lumix/uji/bin/lumix-helper-palsu.exe
   Copies the behaviour the helper uses: one camera found, live view JPEG, shooting (a transfer
   request + the JPEG), recording a video to the "card", copying a file in parts.
   Scenario through the environment variable LUMIX_PALSU:
     (empty)       camera there & normal
     no-camera     no camera connected
     raw-jpeg      RAW+JPEG: a RAW transfer request comes first (must be skipped)
     unplug        the camera is unplugged 1.5 s after connecting (live view fails)
     busy-stop     the camera is busy the first 2 times it is asked to stop recording
     dial-video    the mode dial is on video and can't be changed from the computer (like the S5 II) */
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "LMX_func_api.h"

using Clock = std::chrono::steady_clock;
static std::string scenario() {
  const char* s = getenv("LUMIX_PALSU");
  return s ? s : "";
}
static std::map<UINT32, LMX_CALLBACK_FUNC> g_callbacks;
static std::mutex g_mx;
static bool g_open = false, g_liveView = false, g_recording = false;
static Clock::time_point g_openedAt;
static UINT16 g_modePos = Lmx_def_lib_Camera_Mode_Info_Mode_Pos::LMX_DEF_CAMERA_MODE_INFO_MODE_POS_M;
static UINT32 g_nextHandle = 100;
struct FakeObject { UINT32 format; std::string name; std::string data; };
static std::map<UINT32, FakeObject> g_objects;

static UINT8 result(bool ok, UINT32* retError, UINT32 code = Lmx_def_error_code::LMX_DEF_ERR_NO_ERROR) {
  if (retError) *retError = ok ? 0 : code;
  return ok ? LMX_BOOL_TRUE : LMX_BOOL_FALSE;
}
static bool unplugged() {
  return scenario() == "unplug" && g_open && Clock::now() - g_openedAt > std::chrono::milliseconds(1500);
}
// The camera announces a new object a moment later, on its own thread (like the real SDK)
static void announce(UINT32 type, UINT32 handle, int delayMs) {
  std::thread([type, handle, delayMs] {
    std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
    LMX_CALLBACK_FUNC f = nullptr;
    {
      std::lock_guard<std::mutex> l(g_mx);
      auto it = g_callbacks.find(type);
      if (it != g_callbacks.end()) f = it->second;
    }
    if (f) f(type, handle);
  }).detach();
}
static UINT32 addObject(UINT32 format, const std::string& name, const std::string& data) {
  std::lock_guard<std::mutex> l(g_mx);
  UINT32 h = ++g_nextHandle;
  g_objects[h] = {format, name, data};
  return h;
}
static std::string fakeJpeg(const char* text) {
  std::string j = "\xFF\xD8\xFF\xE0";
  j += text;
  j += "\xFF\xD9";
  return j;
}

void LMX_API LMX_func_api_Init(void) {}
UINT8 LMX_API LMX_func_api_Close_Device(UINT32* retError) {
  g_open = false;
  return result(true, retError);
}
UINT8 LMX_API LMX_func_api_Get_PnPDeviceInfo(PLMX_CONNECT_DEVICE_INFO info, UINT32* retError) {
  memset(info, 0, sizeof *info);
  if (scenario() == "no-camera") return result(true, retError);
  info->find_PnpDevice_Count = 1;
  wcscpy_s(info->find_PnpDevice_Info[0].dev_ModelName, L"DC-S5M2");
  wcscpy_s(info->find_PnpDevice_Info[0].dev_MakerName, L"DC-S5M2"); // the real SDK gives the model here too
  return result(true, retError);
}
UINT8 LMX_API LMX_func_api_Select_PnPDevice(UINT32 index, PLMX_CONNECT_DEVICE_INFO info, UINT32* retError) {
  return result(index < info->find_PnpDevice_Count, retError, Lmx_def_error_code::LMX_DEF_ERR_DEV_OPEN);
}
UINT8 LMX_API LMX_func_api_Open_Session(UINT32, UINT32* version, UINT32* retError) {
  g_open = true;
  g_openedAt = Clock::now();
  if (version) *version = 0x00010001;
  return result(true, retError);
}
UINT8 LMX_API LMX_func_api_Close_Session(UINT32* retError) { return result(true, retError); }
UINT32 LMX_API LMX_func_api_Reg_NotifyCallback(UINT32 type, LMX_CALLBACK_FUNC f) {
  std::lock_guard<std::mutex> l(g_mx);
  g_callbacks[type] = f;
  return 0;
}
UINT32 LMX_API LMX_func_api_Delete_CallBackInfo(UINT32 type) {
  std::lock_guard<std::mutex> l(g_mx);
  g_callbacks.erase(type);
  return 0;
}
UINT8 LMX_API LMX_func_api_SetupFilesConfig_Set_Target(UINT16, UINT32* retError) { return result(true, retError); }
UINT8 LMX_API LMX_func_api_SetupFilesConfig_Get_Target(UINT16* t, UINT32* retError) {
  *t = Lmx_def_lib_setup_cfg_filesetting_target_cfg::LMX_DEF_SETUP_CFG_FILE_TARGET_CFG_PC_AND_CAMERA;
  return result(true, retError);
}
UINT8 LMX_API LMX_func_api_LiveView_Str_Get_Recom_Img(LMX_STRUCT_LIVEVIEW_STR_RECOM_IMG* list, UINT32* retError) {
  list->RecomImgQualityListCount = 2;
  list->RecomImgQualityListData[0] = {640, 0, 30};
  list->RecomImgQualityListData[1] = {1920, 0, 30};
  return result(true, retError);
}
UINT8 LMX_API LMX_func_api_LiveView_Str_Set_Trans_Img(LMX_STRUCT_LIVEVIEW_STR_TRANS_IMG, UINT32* retError) {
  return result(true, retError);
}
UINT8 LMX_API LMX_func_api_Ctrl_LiveView_Start(UINT32* retError) {
  g_liveView = true;
  return result(true, retError);
}
UINT8 LMX_API LMX_func_api_Ctrl_LiveView_Stop(UINT32* retError) {
  g_liveView = false;
  return result(true, retError);
}
UINT8 LMX_API LMX_func_api_Get_LiveView_data(LMX_STRUCT_LIVEVIEW_INFO_HISTGRAM*, UINT32*, LMX_STRUCT_LIVEVIEW_INFO_POSTURE*,
                                             UINT32*, LMX_STRUCT_LIVEVIEW_INFO_LEVEL*, UINT32*, UINT8* jpeg,
                                             UINT32* jpegSize, UINT32* retError) {
  if (unplugged()) return result(false, retError, Lmx_def_error_code::LMX_DEF_ERR_DEV_NEED_OPEN);
  if (!g_open || !g_liveView) return result(false, retError, Lmx_def_error_code::LMX_DEF_ERR_COM_SESSION_NOT_OPENED);
  std::string j = fakeJpeg("live view");
  memcpy(jpeg, j.data(), j.size());
  *jpegSize = (UINT32)j.size();
  return result(true, retError);
}
UINT8 LMX_API LMX_func_api_Rec_Ctrl_Release(LMX_STRUCT_REC_CTRL*, UINT32* retError) {
  if (!g_open) return result(false, retError, Lmx_def_error_code::LMX_DEF_ERR_DEV_NEED_OPEN);
  const UINT32 TRANSFER = Lmx_event_id::LMX_DEF_LIB_EVENT_ID_OBJCT_REQ_TRNSFER;
  if (scenario() == "raw-jpeg")
    announce(TRANSFER, addObject(Lmx_def_lib_object_format::LMX_DEF_OBJ_FORMAT_RAW, "P1000001.RW2", "raw data"), 200);
  announce(TRANSFER, addObject(Lmx_def_lib_object_format::LMX_DEF_OBJ_FORMAT_JPEG, "P1000001.JPG", fakeJpeg("photo")),
           400);
  return result(true, retError);
}
UINT8 LMX_API LMX_func_api_MoveRec_Ctrl_Start(UINT32* retError) {
  g_recording = true;
  return result(g_open, retError, Lmx_def_error_code::LMX_DEF_ERR_DEV_NEED_OPEN);
}
static int g_stopTries = 0;
UINT8 LMX_API LMX_func_api_MoveRec_Ctrl_Stop(UINT8, UINT32* retError) {
  if (scenario() == "busy-stop" && g_recording && ++g_stopTries <= 2)
    return result(false, retError, Lmx_def_error_code::LMX_DEF_ERR_COM_DATA_BUSY);
  if (!g_recording) return result(false, retError, Lmx_def_error_code::LMX_DEF_ERR_CAM);
  g_recording = false;
  // A video of ±20 MB, so it is copied in several parts (8 MB each)
  std::string video = "fake video";
  video.resize(20 * 1024 * 1024 + 123, 'v');
  announce(Lmx_event_id::LMX_DEF_LIB_EVENT_ID_OBJCT_ADD,
           addObject(Lmx_def_lib_object_format::LMX_DEF_OBJ_FORMAT_MOVIE_MP4, "P1000002.MP4", video), 600);
  return result(true, retError);
}
static FakeObject* object(UINT32 h) {
  std::lock_guard<std::mutex> l(g_mx);
  auto it = g_objects.find(h);
  return it == g_objects.end() ? nullptr : &it->second;
}
UINT8 LMX_API LMX_func_api_Get_Object_FormatType(UINT32 h, UINT32* format, UINT32* retError) {
  FakeObject* o = object(h);
  if (o) *format = o->format;
  return result(o != nullptr, retError, Lmx_def_error_code::LMX_DEF_ERR_FUNC_PARAM);
}
UINT8 LMX_API LMX_func_api_Get_Object_DataSize(UINT32 h, UINT64* size, UINT32* retError) {
  FakeObject* o = object(h);
  if (o) *size = o->data.size();
  return result(o != nullptr, retError, Lmx_def_error_code::LMX_DEF_ERR_FUNC_PARAM);
}
UINT8 LMX_API LMX_func_api_Get_Object_FileName(UINT32 h, LMX_STRUCT_PTP_ARRAY_STRING* name, UINT32* retError) {
  FakeObject* o = object(h);
  if (!o) return result(false, retError, Lmx_def_error_code::LMX_DEF_ERR_FUNC_PARAM);
  memset(name, 0, sizeof *name);
  name->NumChars = (UINT8)(o->name.size() + 1);
  memcpy(name->StringChars, o->name.c_str(), o->name.size());
  return result(true, retError);
}
UINT8 LMX_API LMX_func_api_Get_Partial_ObjectEx(UINT32 h, UINT8* buf, UINT64 offset, UINT32 n, UINT32* retError) {
  FakeObject* o = object(h);
  if (!o || offset + n > o->data.size()) return result(false, retError, Lmx_def_error_code::LMX_DEF_ERR_FUNC_PARAM);
  memcpy(buf, o->data.data() + offset, n);
  return result(true, retError);
}
static std::atomic<int> g_skipped{0};
UINT8 LMX_API LMX_func_api_Skip_Object_Transfer(UINT32, UINT32* retError) {
  g_skipped++;
  return result(true, retError);
}
UINT8 LMX_API LMX_func_api_CameraMode_Get_Capability(LMX_STRUCT_RECINFO_CAMERA_MODE_CAPA_INFO* capa, UINT32* retError) {
  memset(capa, 0, sizeof *capa);
  if (scenario() == "dial-video") {
    capa->CurVal_mode_pos = Lmx_def_lib_Camera_Mode_Info_Mode_Pos::LMX_DEF_CAMERA_MODE_INFO_MODE_POS_MOVREC;
    return result(true, retError); // no list of modes: can't be changed from the computer
  }
  const UINT16 modes[] = {0, 1, 2, 3, Lmx_def_lib_Camera_Mode_Info_Mode_Pos::LMX_DEF_CAMERA_MODE_INFO_MODE_POS_MOVREC};
  capa->Capa_Enum_mode_pos.NumOfVal = 5;
  for (int i = 0; i < 5; i++) capa->Capa_Enum_mode_pos.SupportVal[i] = modes[i];
  capa->CurVal_mode_pos = g_modePos;
  return result(true, retError);
}
UINT8 LMX_API LMX_func_api_CameraMode_Set_Mode_Pos(UINT32 pos, UINT32* retError) {
  g_modePos = (UINT16)pos;
  return result(true, retError);
}
