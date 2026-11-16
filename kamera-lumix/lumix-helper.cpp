/* =====================================================================
   lumix-helper.cpp — helper program between the app and a Panasonic Lumix
   camera (Lumix Tether SDK "Lmxptpif", USB, Windows only).

   Run by main/sony-camera.js as a separate process, so if the camera or the
   SDK misbehaves the app itself keeps running.

   It speaks EXACTLY the same protocol as kamera-sony/sony-helper.cpp, so the
   app treats both cameras the same way. The protocol words stay Indonesian
   (sambung, foto, rekam-mulai, tersambung, …) like the Sony helper; the
   messages for the operator are English.

   Commands come in on stdin, one line per command, separated by TAB:
       <id> TAB <command> TAB <arg1> TAB <arg2> ...
   Answers & events go out on stdout, one JSON line per message:
       {"id":7,"ok":true,...}          answer to command 7
       {"ev":"terputus"}               event from the camera

   Commands:
       sambung <tempFolder>      find the USB camera, connect, start live view
       putus                     disconnect the camera
       status                    connected, recording, copying
       lv                        one live view image (JPEG base64)
       foto <folder>             shoot, wait until the JPEG is copied into <folder>
       rekam-mulai               start recording video (to the camera's SD card)
       rekam-stop                stop recording, wait for the new video file
       unduh <slot> <contentId> <fileId> <folder>
                                 copy a file from the camera to <folder>
                                 (contentId = Lumix object handle; runs in the
                                 background; done = event "unduh-selesai")
       mode [foto|video]         no argument: read the camera mode
                                 foto/video: switch mode from the computer
                                 (only if the camera allows it)
       keluar
   ===================================================================== */
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <deque>
#include <functional>
#include <iostream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "LMX_func_api.h"

using Clock = std::chrono::steady_clock;

/* ---------------- Output (safe from several threads) ---------------- */
static std::mutex g_outMutex;
static void send(const std::string& json) {
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
static void answerOk(long id, const std::string& body = "") {
  send("{\"id\":" + std::to_string(id) + ",\"ok\":true" + (body.empty() ? "" : "," + body) + "}");
}
static void answerFail(long id, const std::string& message, uint32_t code = 0) {
  send("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"error\":\"" + esc(message) + "\"" +
       (code ? ",\"kode\":\"" + hex(code) + "\"" : "") + "}");
}
static void event(const std::string& ev, const std::string& body = "") {
  send("{\"ev\":\"" + ev + "\"" + (body.empty() ? "" : "," + body) + "}");
}

/* ---------------- Text helpers ---------------- */
static std::string utf8(const wchar_t* w) {
  if (!w || !*w) return "";
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
  std::string s(n > 0 ? n - 1 : 0, '\0');
  if (n > 1) WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], n, nullptr, nullptr);
  return s;
}
static std::wstring wide(const std::string& s) {
  if (s.empty()) return L"";
  int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
  std::wstring w(n > 0 ? n - 1 : 0, L'\0');
  if (n > 1) MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], n);
  return w;
}
static std::string base64(const uint8_t* d, size_t n) {
  static const char* t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string o;
  o.reserve((n + 2) / 3 * 4);
  for (size_t i = 0; i < n; i += 3) {
    uint32_t v = d[i] << 16 | (i + 1 < n ? d[i + 1] << 8 : 0) | (i + 2 < n ? d[i + 2] : 0);
    o += t[v >> 18 & 63];
    o += t[v >> 12 & 63];
    o += i + 1 < n ? t[v >> 6 & 63] : '=';
    o += i + 2 < n ? t[v & 63] : '=';
  }
  return o;
}
// File name on the camera (e.g. P1000123.JPG); only safe characters are kept
static std::string safeFileName(const std::string& s, const std::string& fallback) {
  std::string o;
  for (char c : s)
    if (isalnum((unsigned char)c) || c == '.' || c == '_' || c == '-') o += c;
  return o.empty() || o == "." || o == ".." ? fallback : o;
}
static std::string joinPath(const std::string& dir, const std::string& name) {
  if (dir.empty()) return name;
  char last = dir.back();
  return dir + (last == '\\' || last == '/' ? "" : "\\") + name;
}

/* ---------------- Camera state ---------------- */
// Every SDK call goes through this lock: the live view, the commands and the background copy
// take turns (the SDK talks to one camera over one USB connection).
static std::recursive_mutex g_sdk;
static std::atomic<bool> g_connected{false};
static std::atomic<bool> g_recording{false};
static std::atomic<int> g_copying{0};
// Live view goes first: while a live view frame waits for the camera, the background copy pauses
// (measured on a DC-S5M2X: copying a video in 8 MB parts made the live view drop to ±1 frame/s).
static std::atomic<int> g_lvWaiting{0};
// Photo & stop-recording run on their own thread, so the live view keeps running meanwhile
static std::atomic<int> g_commandsRunning{0};
static bool g_initialized = false;
static std::string g_model;
static int g_lvFailures = 0;
static int g_lastPhotoPos = -1; // the photo mode (P/A/S/M…) used before switching to video

// Object events from the camera (new file, transfer request). The SDK calls the callback on its
// own thread; nothing is done with the SDK there, the events are handled by the commands.
struct ObjectEvent { UINT32 type; UINT32 handle; };
static std::mutex g_evMutex;
static std::condition_variable g_evCv;
static std::deque<ObjectEvent> g_events;

static int WINAPI onCameraEvent(UINT32 type, UINT32 param) {
  {
    std::lock_guard<std::mutex> l(g_evMutex);
    g_events.push_back({type, param});
    if (g_events.size() > 200) g_events.pop_front();
  }
  g_evCv.notify_all();
  return 0;
}

static const UINT32 EV_ADD = Lmx_event_id::LMX_DEF_LIB_EVENT_ID_OBJCT_ADD;
static const UINT32 EV_TRANSFER = Lmx_event_id::LMX_DEF_LIB_EVENT_ID_OBJCT_REQ_TRNSFER;

static UINT32 objectFormat(UINT32 handle) {
  UINT32 f = 0, err = 0;
  std::lock_guard<std::recursive_mutex> l(g_sdk);
  LMX_func_api_Get_Object_FormatType(handle, &f, &err);
  return f;
}
static bool isPhoto(UINT32 f) { return f == Lmx_def_lib_object_format::LMX_DEF_OBJ_FORMAT_JPEG; }
static bool isRaw(UINT32 f) { return f == Lmx_def_lib_object_format::LMX_DEF_OBJ_FORMAT_RAW; }
static bool isVideo(UINT32 f) {
  return f == Lmx_def_lib_object_format::LMX_DEF_OBJ_FORMAT_MOVIE_MP4 ||
         f == Lmx_def_lib_object_format::LMX_DEF_OBJ_FORMAT_MOVIE_MOV;
}

// A transfer request nobody waits for (e.g. the operator pressed the shutter on the camera):
// tell the camera to skip it, otherwise it waits for the computer.
static void skipStrayTransfers() {
  std::vector<UINT32> stray;
  {
    std::lock_guard<std::mutex> l(g_evMutex);
    for (auto it = g_events.begin(); it != g_events.end();) {
      if (it->type == EV_TRANSFER) { stray.push_back(it->handle); it = g_events.erase(it); }
      else ++it;
    }
  }
  std::lock_guard<std::recursive_mutex> l(g_sdk);
  for (UINT32 h : stray) { UINT32 err = 0; LMX_func_api_Skip_Object_Transfer(h, &err); }
}
static void clearEvents() {
  skipStrayTransfers();
  std::lock_guard<std::mutex> l(g_evMutex);
  g_events.clear();
}
// Wait for the next object event (max ms). false = nothing came.
static bool nextEvent(ObjectEvent& out, int ms) {
  std::unique_lock<std::mutex> l(g_evMutex);
  if (!g_evCv.wait_for(l, std::chrono::milliseconds(ms), [] { return !g_events.empty(); })) return false;
  out = g_events.front();
  g_events.pop_front();
  return true;
}

static void markDisconnected(uint32_t code) {
  if (!g_connected.exchange(false)) return;
  g_recording = false;
  event("terputus", code ? "\"kode\":\"" + hex(code) + "\"" : "");
}
static bool lostConnection(uint32_t err) {
  return err == Lmx_def_error_code::LMX_DEF_ERR_DEV_NEED_OPEN ||
         err == Lmx_def_error_code::LMX_DEF_ERR_COM_SESSION_NOT_OPENED ||
         err == Lmx_def_error_code::LMX_DEF_ERR_COM_TIMEOUT_RECONNECT_ERROR ||
         err == Lmx_def_error_code::LMX_DEF_ERR_DEV_DETECT;
}

/* ---------------- Copy a file from the camera ---------------- */
// Copies object `handle` into `folder` (8 MB at a time; the live view can run in between).
// progress(percent) is called now and then. Returns the full file path, or "" (error in `error`).
static std::string copyObject(UINT32 handle, const std::string& folder, const std::string& fallbackName,
                              std::string& error, const std::function<void(int)>& progress = nullptr) {
  UINT64 size = 0;
  LMX_STRUCT_PTP_ARRAY_STRING name = {};
  UINT32 err = 0;
  {
    std::lock_guard<std::recursive_mutex> l(g_sdk);
    if (!LMX_func_api_Get_Object_DataSize(handle, &size, &err) || !size) {
      error = "file size unknown " + hex(err);
      return "";
    }
    LMX_func_api_Get_Object_FileName(handle, &name, &err);
  }
  std::string raw;
  if (name.NumChars > 1) raw.assign((const char*)name.StringChars, (size_t)name.NumChars - 1);
  std::string file = joinPath(folder, safeFileName(raw, fallbackName));
  FILE* fp = _wfopen(wide(file).c_str(), L"wb");
  if (!fp) { error = "cannot create " + file; return ""; }
  // Parts of 1 MB (±80 ms over USB): live view ±5 frames/s while copying (512 KB: hardly smoother, copy 2x slower)
  const UINT64 CHUNK = 1024 * 1024;
  std::unique_ptr<UINT8[]> buf(new UINT8[(size_t)std::min(CHUNK, size)]);
  UINT64 done = 0;
  int lastPercent = -1;
  while (done < size) {
    UINT32 n = (UINT32)std::min(CHUNK, size - done);
    bool ok;
    for (int i = 0; i < 100 && g_lvWaiting > 0; i++) std::this_thread::sleep_for(std::chrono::milliseconds(2));
    {
      std::lock_guard<std::recursive_mutex> l(g_sdk);
      ok = LMX_func_api_Get_Partial_ObjectEx(handle, buf.get(), done, n, &err) == LMX_BOOL_TRUE;
    }
    if (!ok || fwrite(buf.get(), 1, n, fp) != n) {
      fclose(fp);
      _wremove(wide(file).c_str());
      error = ok ? "disk write error" : "camera read error " + hex(err);
      if (!ok && lostConnection(err)) markDisconnected(err);
      return "";
    }
    done += n;
    int percent = (int)(done * 100 / size);
    if (progress && percent / 10 != lastPercent / 10) progress(percent);
    lastPercent = percent;
  }
  fclose(fp);
  return file;
}

/* ---------------- Commands ---------------- */
static void disconnect() {
  std::lock_guard<std::recursive_mutex> l(g_sdk);
  if (!g_connected && !g_model.size()) return;
  UINT32 err = 0;
  LMX_func_api_Ctrl_LiveView_Stop(&err);
  LMX_func_api_Delete_CallBackInfo(EV_ADD);
  LMX_func_api_Delete_CallBackInfo(EV_TRANSFER);
  LMX_func_api_Close_Session(&err);
  LMX_func_api_Close_Device(&err);
  g_connected = false;
  g_recording = false;
  g_model.clear();
}

// Live view: the largest image the camera recommends (the booth shows it full screen)
static void chooseLiveViewQuality() {
  auto list = std::make_unique<LMX_STRUCT_LIVEVIEW_STR_RECOM_IMG>();
  UINT32 err = 0;
  if (!LMX_func_api_LiveView_Str_Get_Recom_Img(list.get(), &err)) return;
  int best = -1;
  std::string options;
  for (int i = 0; i < list->RecomImgQualityListCount && i < 1024; i++) {
    auto& q = list->RecomImgQualityListData[i];
    // Resolution = width in the upper 16 bits, height in the lower 16 bits
    options += " " + std::to_string(q.Resolution >> 16) + "x" + std::to_string(q.Resolution & 0xFFFF) + "@" +
               std::to_string(q.FrameRate) + "fps";
    if (best < 0 || q.Resolution > list->RecomImgQualityListData[best].Resolution) best = i;
  }
  // For measuring only: LUMIX_LV=0,1,2… picks an option by its place in the list
  char pickEnv[8] = "";
  size_t pickLen = 0;
  if (getenv_s(&pickLen, pickEnv, sizeof pickEnv, "LUMIX_LV") == 0 && pickLen > 1) {
    int i = atoi(pickEnv);
    if (i >= 0 && i < list->RecomImgQualityListCount) best = i;
  }
  fprintf(stderr, "Live view options:%s (using #%d)\n", options.c_str(), best); // goes into the app log
  if (best >= 0) LMX_func_api_LiveView_Str_Set_Trans_Img(list->RecomImgQualityListData[best], &err);
}

static void cmdConnect(long id, const std::vector<std::string>&) {
  std::lock_guard<std::recursive_mutex> l(g_sdk);
  if (g_connected) return answerOk(id, "\"model\":\"" + esc(g_model) + "\"");
  if (!g_initialized) { LMX_func_api_Init(); g_initialized = true; }
  disconnect(); // a half-open connection from an earlier attempt
  // ±500 KB: on the heap, not the stack
  auto devices = std::make_unique<LMX_CONNECT_DEVICE_INFO>();
  UINT32 err = 0;
  LMX_func_api_Get_PnPDeviceInfo(devices.get(), &err);
  // Windows lists every portable device (phones, media players, other cameras): pick the Panasonic one
  UINT32 count = std::min<UINT32>(devices->find_PnpDevice_Count, DEVINFO_DEF_ARRAY_MAX);
  std::string found;
  int pick = -1;
  for (UINT32 i = 0; i < count; i++) {
    std::string mk = utf8(devices->find_PnpDevice_Info[i].dev_MakerName);
    std::string md = utf8(devices->find_PnpDevice_Info[i].dev_ModelName);
    found += (found.empty() ? "" : ", ") + (mk.empty() || mk == md ? md : mk + " " + md);
    // The SDK may give the model name in both fields (e.g. "DC-S5M2X"): Lumix models start with DC- or DMC-
    std::string low = mk + " " + md;
    for (auto& c : low) c = (char)tolower((unsigned char)c);
    bool lumix = low.find("panasonic") != std::string::npos || low.find("lumix") != std::string::npos ||
                 md.rfind("DC-", 0) == 0 || md.rfind("DMC-", 0) == 0 || mk.rfind("DC-", 0) == 0;
    if (pick < 0 && lumix) pick = (int)i;
  }
  if (pick < 0)
    return answerFail(id,
                      "No Lumix camera found. Connect the USB cable, turn the camera on and set its USB mode to "
                      "PC(Tether)." +
                          (found.empty() ? std::string() : " (Other devices seen: " + found + ")"),
                      err);
  if (!LMX_func_api_Select_PnPDevice((UINT32)pick, devices.get(), &err))
    return answerFail(id, "The Lumix camera was found but could not be opened. Close other apps using the camera "
                          "(LUMIX Tether, Windows Photos) and turn the camera off and on.", err);
  UINT32 version = 0;
  if (!LMX_func_api_Open_Session(0x00010001, &version, &err) &&
      err != Lmx_def_error_code::LMX_DEF_ERR_COM_SESSION_ALREADY_OPENED) {
    UINT32 openErr = err;
    LMX_func_api_Close_Device(&err);
    return answerFail(id, "The Lumix camera refused the connection. Set the camera's USB mode to PC(Tether).",
                      openErr);
  }
  g_model = utf8(devices->find_PnpDevice_Info[pick].dev_ModelName);
  std::string maker = utf8(devices->find_PnpDevice_Info[pick].dev_MakerName);
  if (g_model.empty()) g_model = "Lumix";
  LMX_func_api_Reg_NotifyCallback(EV_ADD, onCameraEvent);
  LMX_func_api_Reg_NotifyCallback(EV_TRANSFER, onCameraEvent);
  std::string notes;
  // Photos: to the computer AND the camera card (the card keeps the original)
  if (!LMX_func_api_SetupFilesConfig_Set_Target(
          Lmx_def_lib_setup_cfg_filesetting_target_cfg::LMX_DEF_SETUP_CFG_FILE_TARGET_CFG_PC_AND_CAMERA, &err))
    notes += "save target " + hex(err) + "; ";
  chooseLiveViewQuality();
  if (!LMX_func_api_Ctrl_LiveView_Start(&err)) notes += "live view " + hex(err) + "; ";
  g_connected = true;
  g_lvFailures = 0;
  clearEvents();
  answerOk(id, "\"model\":\"" + esc(g_model) + "\"" + (maker.empty() ? "" : ",\"maker\":\"" + esc(maker) + "\"") +
                   (notes.empty() ? "" : ",\"catatan\":\"" + esc(notes) + "\""));
}

static void cmdStatus(long id) {
  // The Lumix SDK has no battery / card information: only the connection state
  answerOk(id, std::string("\"tersambung\":") + (g_connected ? "true" : "false") + ",\"model\":\"" + esc(g_model) +
                   "\",\"merekam\":" + (g_recording ? "true" : "false") +
                   ",\"mengunduh\":" + (g_copying > 0 ? "true" : "false"));
}

static void cmdLiveView(long id) {
  if (!g_connected) return answerFail(id, "Camera not connected");
  static std::unique_ptr<UINT8[]> jpeg(new UINT8[LMX_DEF_LIVEVIEW_STREAMDATA_SIZE_MAX]);
  LMX_STRUCT_LIVEVIEW_INFO_HISTGRAM hist;
  LMX_STRUCT_LIVEVIEW_INFO_POSTURE posture;
  LMX_STRUCT_LIVEVIEW_INFO_LEVEL level;
  UINT32 err = 0;
  for (int attempt = 0; attempt < 20; attempt++) {
    UINT32 histSize = sizeof hist, postureSize = sizeof posture, levelSize = sizeof level;
    UINT32 size = LMX_DEF_LIVEVIEW_STREAMDATA_SIZE_MAX;
    bool ok;
    {
      g_lvWaiting++;
      std::lock_guard<std::recursive_mutex> l(g_sdk);
      g_lvWaiting--;
      ok = LMX_func_api_Get_LiveView_data(&hist, &histSize, &posture, &postureSize, &level, &levelSize, jpeg.get(),
                                          &size, &err) == LMX_BOOL_TRUE;
    }
    if (ok && size > 0 && size <= LMX_DEF_LIVEVIEW_STREAMDATA_SIZE_MAX) {
      g_lvFailures = 0;
      return answerOk(id, "\"jpg\":\"" + base64(jpeg.get(), size) + "\"");
    }
    if (!ok && err != Lmx_def_error_code::LMX_DEF_ERR_COM_DATA_BUSY) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  // Many failures in a row, or the SDK says the device is gone: the camera is disconnected
  if (lostConnection(err) || ++g_lvFailures >= 30) markDisconnected(err);
  answerFail(id, "No live view image", err);
}

static void cmdPhoto(long id, const std::vector<std::string>& a) {
  if (!g_connected) return answerFail(id, "Camera not connected");
  std::string folder = a.size() > 0 ? a[0] : "";
  // Dial on video (cameras like the S5 II can't change it from the computer): the shutter takes no photo there
  {
    std::lock_guard<std::recursive_mutex> l(g_sdk);
    LMX_STRUCT_RECINFO_CAMERA_MODE_CAPA_INFO capa = {};
    UINT32 e = 0;
    if (LMX_func_api_CameraMode_Get_Capability(&capa, &e) &&
        capa.CurVal_mode_pos == Lmx_def_lib_Camera_Mode_Info_Mode_Pos::LMX_DEF_CAMERA_MODE_INFO_MODE_POS_MOVREC)
      return answerFail(id, "The camera mode dial is on video: turn it to a photo mode (P/A/S/M). "
                            "Video recording works in the photo modes too.");
  }
  clearEvents();
  auto t0 = Clock::now();
  LMX_STRUCT_REC_CTRL ctrl = {};
  ctrl.CtrlID = Lmx_TagID_Rec_Ctrl_Release::LMX_DEF_LIB_TAG_REC_CTRL_RELEASE_ONESHOT;
  ctrl.ParamData.NumOfVal = 0;
  UINT32 err = 0;
  bool shot;
  {
    std::lock_guard<std::recursive_mutex> l(g_sdk);
    shot = LMX_func_api_Rec_Ctrl_Release(&ctrl, &err) == LMX_BOOL_TRUE;
  }
  if (!shot) {
    if (lostConnection(err)) markDisconnected(err);
    return answerFail(id,
                      err == Lmx_def_error_code::LMX_DEF_ERR_CAM_INVALID_MODE
                          ? "The camera can't take a photo in this mode. Turn the mode dial to a photo mode (P/A/S/M)."
                          : "The camera did not take the photo (check focus, card and lens)",
                      err);
  }
  // The JPEG arrives as an object event (RAW in RAW+JPEG mode is skipped)
  auto until = t0 + std::chrono::seconds(15);
  while (Clock::now() < until) {
    ObjectEvent ev;
    int left = (int)std::chrono::duration_cast<std::chrono::milliseconds>(until - Clock::now()).count();
    if (!nextEvent(ev, std::max(left, 1))) break;
    UINT32 f = objectFormat(ev.handle);
    if (isPhoto(f)) {
      std::string error;
      std::string file = copyObject(ev.handle, folder, "LUMIX_" + std::to_string(ev.handle) + ".JPG", error);
      if (file.empty()) return answerFail(id, "The photo could not be copied from the camera: " + error);
      long ms = (long)std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - t0).count();
      return answerOk(id, "\"file\":\"" + esc(file) + "\",\"ms\":" + std::to_string(ms));
    }
    if (ev.type == EV_TRANSFER && (isRaw(f) || !isVideo(f))) {
      std::lock_guard<std::recursive_mutex> l(g_sdk);
      LMX_func_api_Skip_Object_Transfer(ev.handle, &err);
    }
  }
  answerFail(id, "The photo was taken but did not arrive from the camera. Check that the photo format includes JPEG.");
}

// The camera can be busy for a moment (e.g. still writing the previous video to the card, or just after a
// copy): try again for up to `ms` before giving up. Not when the camera is gone.
static bool retryWhileBusy(const std::function<bool(UINT32&)>& call, UINT32& err, int ms) {
  auto until = Clock::now() + std::chrono::milliseconds(ms);
  for (;;) {
    {
      std::lock_guard<std::recursive_mutex> l(g_sdk);
      if (call(err)) return true;
    }
    if (lostConnection(err) || Clock::now() >= until) return false;
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
  }
}

static void cmdRecordStart(long id) {
  if (!g_connected) return answerFail(id, "Camera not connected");
  clearEvents();
  UINT32 err = 0;
  bool ok = retryWhileBusy([](UINT32& e) { return LMX_func_api_MoveRec_Ctrl_Start(&e) == LMX_BOOL_TRUE; }, err, 3000);
  if (!ok) {
    if (lostConnection(err)) markDisconnected(err);
    return answerFail(id, "The camera did not start recording (check the SD card and the video mode)", err);
  }
  g_recording = true;
  answerOk(id);
}

static void cmdRecordStop(long id) {
  if (!g_connected) return answerFail(id, "Camera not connected");
  UINT32 err = 0;
  // Stopping matters most: a video that keeps recording fills the card. Try for up to 8 seconds.
  bool ok = retryWhileBusy([](UINT32& e) { return LMX_func_api_MoveRec_Ctrl_Stop(0, &e) == LMX_BOOL_TRUE; }, err, 8000);
  g_recording = false;
  if (!ok) {
    if (lostConnection(err)) markDisconnected(err);
    return answerFail(id, "The camera did not stop recording", err);
  }
  // The new video file is announced when the camera has finished writing it to the card
  auto until = Clock::now() + std::chrono::seconds(35); // + up to 8 s stopping: within the app's 45 s
  while (Clock::now() < until) {
    ObjectEvent ev;
    int left = (int)std::chrono::duration_cast<std::chrono::milliseconds>(until - Clock::now()).count();
    if (!nextEvent(ev, std::max(left, 1))) break;
    UINT32 f = objectFormat(ev.handle);
    if (!isVideo(f)) {
      if (ev.type == EV_TRANSFER) {
        std::lock_guard<std::recursive_mutex> l(g_sdk);
        LMX_func_api_Skip_Object_Transfer(ev.handle, &err);
      }
      continue;
    }
    UINT64 size = 0;
    LMX_STRUCT_PTP_ARRAY_STRING name = {};
    {
      std::lock_guard<std::recursive_mutex> l(g_sdk);
      LMX_func_api_Get_Object_DataSize(ev.handle, &size, &err);
      LMX_func_api_Get_Object_FileName(ev.handle, &name, &err);
    }
    std::string raw;
    if (name.NumChars > 1) raw.assign((const char*)name.StringChars, (size_t)name.NumChars - 1);
    return answerOk(id, "\"slot\":1,\"contentId\":" + std::to_string(ev.handle) + ",\"fileId\":0,\"nama\":\"" +
                            esc(safeFileName(raw, "LUMIX_" + std::to_string(ev.handle) + ".MP4")) +
                            "\",\"ukuran\":" + std::to_string(size));
  }
  answerFail(id, "The video is saved on the SD card, but the new file was not announced by the camera");
}

static void cmdDownload(long id, const std::vector<std::string>& a) {
  if (!g_connected) return answerFail(id, "Camera not connected");
  if (a.size() < 4) return answerFail(id, "Missing arguments for unduh");
  UINT32 handle = (UINT32)std::stoul(a[1]);
  std::string folder = a[3];
  g_copying++;
  answerOk(id, "\"job\":" + std::to_string(id)); // the end is announced with "unduh-selesai"
  std::thread([id, handle, folder] {
    std::string error;
    std::string file = copyObject(handle, folder, "LUMIX_" + std::to_string(handle) + ".MP4", error, [id](int p) {
      event("unduh-progres", "\"job\":" + std::to_string(id) + ",\"persen\":" + std::to_string(p));
    });
    g_copying--;
    if (file.empty()) event("unduh-gagal", "\"job\":" + std::to_string(id) + ",\"kode\":\"" + esc(error) + "\"");
    else event("unduh-selesai", "\"job\":" + std::to_string(id) + ",\"file\":\"" + esc(file) + "\"");
  }).detach();
}

static void cmdMode(long id, const std::vector<std::string>& a) {
  if (!g_connected) return answerFail(id, "Camera not connected");
  const UINT16 MOVIE = Lmx_def_lib_Camera_Mode_Info_Mode_Pos::LMX_DEF_CAMERA_MODE_INFO_MODE_POS_MOVREC;
  const UINT16 P = Lmx_def_lib_Camera_Mode_Info_Mode_Pos::LMX_DEF_CAMERA_MODE_INFO_MODE_POS_P;
  std::lock_guard<std::recursive_mutex> l(g_sdk);
  LMX_STRUCT_RECINFO_CAMERA_MODE_CAPA_INFO capa = {};
  UINT32 err = 0;
  if (!LMX_func_api_CameraMode_Get_Capability(&capa, &err)) return answerFail(id, "Camera mode unknown", err);
  UINT16 cur = capa.CurVal_mode_pos;
  auto kindOf = [MOVIE](UINT16 pos) { return std::string(pos == MOVIE ? "video" : "foto"); };
  auto reply = [&](UINT16 pos, bool changed) {
    answerOk(id, "\"jenis\":\"" + kindOf(pos) + "\",\"mode\":\"" + hex(pos) + "\",\"diubah\":" +
                     (changed ? "true" : "false") + (changed ? ",\"coba\":1" : ""));
  };
  std::string want = a.size() > 0 ? a[0] : "";
  if (want.empty() || kindOf(cur) == want) return reply(cur, false);
  auto supported = [&](UINT16 pos) {
    for (int i = 0; i < capa.Capa_Enum_mode_pos.NumOfVal; i++)
      if (capa.Capa_Enum_mode_pos.SupportVal[i] == pos) return true;
    return false;
  };
  UINT16 target;
  if (want == "video") target = MOVIE;
  else target = g_lastPhotoPos >= 0 && supported((UINT16)g_lastPhotoPos) ? (UINT16)g_lastPhotoPos : P;
  // Many Lumix models only change mode with the dial: then the booth keeps working in the current mode
  // (a Lumix records video in the photo modes too)
  if (!supported(target)) return reply(cur, false);
  if (!LMX_func_api_CameraMode_Set_Mode_Pos(target, &err)) return reply(cur, false);
  if (want == "video") g_lastPhotoPos = cur;
  reply(target, true);
}

// Run a slow command (waiting for the camera) without holding up the live view. The app sends one
// photo / stop at a time, so they never overlap each other.
static void inBackground(std::function<void()> job) {
  g_commandsRunning++;
  std::thread([job] {
    try {
      job();
    } catch (...) {
      /* the command already answered or the helper is closing: nothing more to do */
    }
    g_commandsRunning--;
  }).detach();
}

static std::vector<std::string> split(const std::string& s) {
  std::vector<std::string> v;
  std::string x;
  std::istringstream in(s);
  while (std::getline(in, x, '\t')) v.push_back(x);
  return v;
}

int main() {
  std::ios::sync_with_stdio(false);
  event("siap", "\"versi\":1,\"merek\":\"lumix\"");
  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    auto parts = split(line);
    if (parts.size() < 2) continue;
    long id = 0;
    try { id = std::stol(parts[0]); } catch (...) { continue; }
    std::string cmd = parts[1];
    std::vector<std::string> arg(parts.begin() + 2, parts.end());
    try {
      if (cmd == "sambung") cmdConnect(id, arg);
      else if (cmd == "putus") { disconnect(); answerOk(id); }
      else if (cmd == "status") cmdStatus(id);
      else if (cmd == "lv") cmdLiveView(id);
      else if (cmd == "foto") inBackground([id, arg] { cmdPhoto(id, arg); });
      else if (cmd == "rekam-mulai") cmdRecordStart(id);
      else if (cmd == "rekam-stop") inBackground([id] { cmdRecordStop(id); });
      else if (cmd == "unduh") cmdDownload(id, arg);
      else if (cmd == "mode") cmdMode(id, arg);
      else if (cmd == "keluar") { answerOk(id); break; }
      else answerFail(id, "Unknown command: " + cmd);
    } catch (const std::exception& ex) {
      answerFail(id, std::string("Error: ") + ex.what());
    }
  }
  // Wait (max 10 s) for a photo / video still being handled or copied, then disconnect cleanly
  for (int i = 0; i < 100 && (g_copying > 0 || g_commandsRunning > 0); i++)
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  if (g_recording) { UINT32 err = 0; LMX_func_api_MoveRec_Ctrl_Stop(0, &err); }
  disconnect();
  return 0;
}
