/* =====================================================================
   state.js — data bersama yang dipakai lintas fitur
   Semua file di folder src/ dimuat sebagai <script> biasa, jadi nilai di
   bawah ini bisa dibaca semua fitur. Supaya jelas siapa memakai apa,
   SEMUA data bersama dideklarasikan di file ini saja.
   ===================================================================== */

// ---------- Alat bantu kecil ----------
const $ = id => document.getElementById(id);                     // ambil elemen berdasarkan id
const sleep = ms => new Promise(r => setTimeout(r, ms));        // tunggu sekian milidetik
const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;   // 75 -> "1:15"
// localStorage dengan pengaman (bisa gagal di beberapa kondisi)
const store = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }
};

// ---------- Daftar halaman ----------
// Setiap halaman di index.html (div.screen) harus terdaftar di sini.
const SCREENS = ['start', 'utama', 'pesan', 'quiz', 'photo', 'editphoto', 'admin', 'setvideo', 'setphoto', 'tambah', 'saving', 'thanks'];
const MAX_Q = 10;                     // maksimal pertanyaan quiz per couple

// ---------- Status aplikasi ----------
let cfg;                              // pengaturan dari main.js (api.getConfig)
let current = 'start';                // halaman yang sedang tampil
let busy = false;                     // true saat merekam / memotret: tombol & idle dikunci
let idleTimer = null, noticeTimer = null;

// ---------- Kamera & mic ----------
let mediaStream = null;               // aliran kamera + mic yang sedang dibuka
let noCam = false;                    // true kalau hanya mic (tanpa kamera)

// ---------- Perekaman video ----------
let rec = null;                       // rekaman yang sedang berjalan
let lastSave = Promise.resolve();     // penyimpanan rekaman terakhir
let recT0 = 0, recTick = null;        // waktu mulai & timer tampilan durasi
let pesanLimit = null;                // timer batas durasi pesan (Pengaturan videobooth)
let sessionToken = 0;                 // naik setiap sesi selesai/batal, untuk menghentikan alur lama
let cancelTimer = null;               // menghentikan timer jawaban quiz

// ---------- Couple ----------
let couplesData = null, activeCouple = null;
let editingId = null, delArmed = null;
