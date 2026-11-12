/* =====================================================================
   video-processing.js — video processing with FFmpeg (one at a time, in the background)
   - Quiz question texts are overlaid on the video (at the bottom), only while
     that question is on. The original video WITHOUT text is kept in
     <couple folder>/original/<name>_original.mp4. The video also gets a
     chapter per question (QuickTime/VLC can jump to the next question).
   - "Phone version" for download by QR: a light 720p MP4 (or 1080p, set in
     Admin) + a cover image, kept temporarily in <data folder>/qr-video/
     and then handed to the upload queue (upload.js).
   Order per session:  (webm → MP4)  →  overlay text (quiz)  →  phone version (if QR video is on)
   Every step is recorded in sessions.json, so if the app is closed halfway,
   the work continues when the app is opened again.
   Session fields set here: captions, captionStatus ('processing' | 'done' |
   'failed'), originalFile, upload ('processing' | 'queued' | 'failed').
   ===================================================================== */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { userData, defaultDir, readSessions, updateSession } = require('./storage');
const log = require('./log');

/* ---------- FFmpeg ---------- */
let ffmpegPath = null;
try {
  // LEURA_TEST_FFMPEG is only used by the automated tests (real FFmpeg on the test computer)
  ffmpegPath = process.env.LEURA_TEST_FFMPEG || require('ffmpeg-static');
  if (ffmpegPath) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
} catch {
  console.log('ffmpeg-static is not installed: recordings are kept as .webm');
}
const available = () => !!ffmpegPath;

const CAPTION_DIR = path.join(userData, 'captions'); // question text images (PNG) from the UI
const PHONE_DIR = path.join(userData, 'qr-video'); // temporary phone versions, deleted after upload
const MAX_CAPTIONS = 20;

// One FFmpeg job at a time (the booth computer stays smooth for the next guest)
let chain = Promise.resolve();
function enqueue(job) {
  const p = chain.then(job).catch(e => log.error('Video processing failed: ' + e.message));
  chain = p;
  return p;
}

function runFfmpeg(args, limitMs = 60 * 60000) {
  return new Promise(resolve => {
    let stderr = '';
    const p = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => {
      try {
        p.kill('SIGKILL');
      } catch {
        /* FFmpeg already stopped by itself */
      }
    }, limitMs);
    p.stderr.on('data', d => {
      stderr = (stderr + d).slice(-4000);
    });
    p.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, stderr: err.message });
    });
    p.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stderr });
    });
  });
}
const lastLine = text => text.split('\n').filter(Boolean).slice(-1)[0];
// Video frame size (takes rotated video into account, e.g. a camera held upright)
async function videoSize(file) {
  const r = await runFfmpeg(['-i', file], 30000); // always "fails" (no output); the description is what we read
  const line = (r.stderr.match(/Stream #\d+:\d+[^\n]*Video:[^\n]*/) || [''])[0];
  const m = line.match(/[ ,](\d{2,5})x(\d{2,5})[ ,[]/);
  if (!m) return null;
  let w = Number(m[1]),
    h = Number(m[2]);
  if (/rotation of -?90/.test(r.stderr)) [w, h] = [h, w];
  const kbps = Number((r.stderr.match(/bitrate: (\d+) kb\/s/) || [])[1]) || 0;
  return { w, h, kbps };
}
// Video encoder: on a Mac the video chip (fast, efficient), otherwise libx264
const macEncoder = kbps => [
  '-c:v',
  'h264_videotoolbox',
  '-b:v',
  Math.max(2500, Math.min(kbps || 12000, 60000)) + 'k',
  '-allow_sw',
  '1',
];
const genericEncoder = crf => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf)];
async function encode(inputArgs, outputArgs, output, { kbps, crf = 20 } = {}) {
  if (process.platform === 'darwin') {
    const r = await runFfmpeg([...inputArgs, ...macEncoder(kbps), '-pix_fmt', 'yuv420p', ...outputArgs, output]);
    if (r.ok) return r;
    log.warn('Mac video encoder failed, using libx264: ' + lastLine(r.stderr));
  }
  return runFfmpeg([...inputArgs, ...genericEncoder(crf), '-pix_fmt', 'yuv420p', ...outputArgs, output]);
}
const removeFile = f => {
  try {
    fs.unlinkSync(f);
  } catch {
    /* the temporary file is already gone */
  }
};
const location = s => path.join(s.dir || defaultDir, s.file || '');
const findSession = sid => readSessions().find(s => s.id === sid);

/* ---------- Question text images (made in the UI, stored here) ---------- */
// captions: [{ a, b, judul }] start & end second of each question; images: one PNG (Uint8Array) per question
function saveCaptions(sid, captions, images) {
  if (!Array.isArray(captions) || !Array.isArray(images) || !captions.length) return null;
  const clean = [];
  try {
    fs.mkdirSync(CAPTION_DIR, { recursive: true });
    for (let i = 0; i < Math.min(captions.length, images.length, MAX_CAPTIONS); i++) {
      const a = Number(captions[i] && captions[i].a),
        b = Number(captions[i] && captions[i].b);
      const u = images[i] instanceof Uint8Array ? images[i] : new Uint8Array(images[i] || []);
      if (!(a >= 0) || !(b > a) || u.length < 8 || u.length > 4 * 1024 * 1024 || u[0] !== 0x89 || u[1] !== 0x50)
        continue;
      fs.writeFileSync(path.join(CAPTION_DIR, `${sid}-${clean.length + 1}.png`), Buffer.from(u));
      clean.push({
        a: Math.round(a * 100) / 100,
        b: Math.round(b * 100) / 100,
        ...(captions[i].title ? { title: String(captions[i].title).slice(0, 300) } : {}),
      });
    }
  } catch (e) {
    log.warn('Quiz question texts could not be saved: ' + e.message);
    return null;
  }
  return clean.length ? clean : null;
}
const captionFile = (sid, i) => path.join(CAPTION_DIR, `${sid}-${i + 1}.png`);
const deleteCaptions = s => (s.captions || []).forEach((_, i) => removeFile(captionFile(s.id, i)));

// One chapter per question (FFMETADATA format)
function chapterText(captions, endSeconds) {
  const esc = t => String(t).replace(/([=;#\\\n])/g, '\\$1');
  return (
    ';FFMETADATA1\n' +
    captions
      .map((k, i) => {
        const end = i + 1 < captions.length ? captions[i + 1].a : Math.max(k.b, endSeconds || k.b);
        return `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(i ? k.a * 1000 : 0)}\nEND=${Math.round(end * 1000)}\ntitle=${esc(`${i + 1}. ${k.title || ''}`.trim())}\n`;
      })
      .join('')
  );
}

// Overlay the question texts on a quiz video. The original video without text → original/<name>_original.mp4
async function overlayText(sid) {
  const s = findSession(sid);
  if (!s || !s.captions || !s.captions.length || !s.file) return;
  const main = location(s);
  const originalDir = path.join(path.dirname(main), 'original');
  const original = path.join(originalDir, s.file.replace(/\.mp4$/i, '') + '_original.mp4');
  const temp = path.join(path.dirname(main), '.' + s.file.replace(/\.mp4$/i, '') + '.teks.mp4');
  const source = fs.existsSync(original) ? original : main; // when retried: start again from the original video
  if (!fs.existsSync(source)) {
    updateSession(sid, {
      status: 'done',
      captionStatus: 'failed',
      error: 'Video file not found for adding the questions',
    });
    return;
  }
  const images = s.captions.map((_, i) => captionFile(sid, i));
  if (images.some(g => !fs.existsSync(g))) {
    updateSession(sid, { status: 'done', captionStatus: 'failed', error: 'Question text images are missing' });
    return;
  }
  updateSession(sid, { status: 'captions', captionStatus: 'processing' });
  const size = await videoSize(source);
  if (!size) {
    updateSession(sid, { status: 'done', captionStatus: 'failed', error: 'Could not read the video size' });
    return;
  }
  // The text images are designed 1920 pixels wide; scaled to the video width, stuck to the bottom
  const filter = [];
  let last = '0:v';
  images.forEach((_, i) => {
    const k = s.captions[i];
    filter.push(`[${i + 1}:v]scale=${size.w}:-2[k${i}]`);
    filter.push(`[${last}][k${i}]overlay=0:H-h:enable='between(t,${k.a},${k.b})'[v${i}]`);
    last = `v${i}`;
  });
  const chapterFile = path.join(CAPTION_DIR, `${sid}-chapters.txt`);
  fs.writeFileSync(chapterFile, chapterText(s.captions, s.seconds));
  const inputs = ['-i', source, ...images.flatMap(g => ['-i', g]), '-f', 'ffmetadata', '-i', chapterFile];
  const r = await encode(
    inputs,
    [
      '-filter_complex',
      filter.join(';'),
      '-map',
      `[${last}]`,
      '-map',
      '0:a?',
      '-map_chapters',
      String(images.length + 1),
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
    ],
    temp,
    { kbps: size.kbps, crf: 20 },
  );
  removeFile(chapterFile);
  if (!r.ok || !fs.existsSync(temp)) {
    removeFile(temp);
    log.error(`Question texts could not be overlaid (${s.file}): ${lastLine(r.stderr) || 'FFmpeg error'}`);
    updateSession(sid, { status: 'done', captionStatus: 'failed' });
    return;
  }
  try {
    if (source === main) {
      fs.mkdirSync(originalDir, { recursive: true });
      fs.renameSync(main, original);
    }
    fs.renameSync(temp, main);
  } catch (e) {
    removeFile(temp);
    log.error(`Question texts could not be saved (${s.file}): ${e.message}`);
    updateSession(sid, { status: 'done', captionStatus: 'failed' });
    return;
  }
  deleteCaptions(s);
  updateSession(sid, {
    status: 'done',
    captionStatus: 'done',
    originalFile: path.relative(path.dirname(main), original),
    error: undefined,
  });
  log.write(`Question texts overlaid: ${s.file} (original: original/${path.basename(original)})`);
}

/* ---------- Phone version for download by QR ---------- */
const phoneFile = sid => path.join(PHONE_DIR, `${sid}.mp4`);
const posterFile = sid => path.join(PHONE_DIR, `${sid}.jpg`);
async function phoneVersion(sid, quality) {
  const s = findSession(sid);
  if (!s || !s.code) return null;
  const source = location(s);
  if (!s.file || !fs.existsSync(source)) return { error: 'Video file not found' };
  fs.mkdirSync(PHONE_DIR, { recursive: true });
  const p = quality === '1080' ? 1080 : 720;
  // Short side of the video = 720 (or 1080); smaller videos are not enlarged
  const scale = `scale=w='if(gt(iw\\,ih)\\,-2\\,min(${p}\\,iw))':h='if(gt(iw\\,ih)\\,min(${p}\\,ih)\\,-2)'`;
  const output = phoneFile(sid),
    poster = posterFile(sid);
  const r = await encode(
    ['-i', source],
    [
      '-vf',
      scale,
      '-r',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      ...(process.platform === 'darwin'
        ? []
        : ['-maxrate', p === 1080 ? '6000k' : '3000k', '-bufsize', p === 1080 ? '12000k' : '6000k']),
    ],
    output,
    { kbps: p === 1080 ? 6000 : 3000, crf: p === 1080 ? 23 : 26 },
  );
  if (!r.ok || !fs.existsSync(output)) {
    removeFile(output);
    return { error: lastLine(r.stderr) || 'FFmpeg error' };
  }
  const g = await runFfmpeg(
    ['-ss', s.seconds > 2 ? '1' : '0', '-i', output, '-frames:v', '1', '-q:v', '4', poster],
    60000,
  );
  return { file: output, poster: g.ok && fs.existsSync(poster) ? poster : null };
}

/* ---------- Full pipeline after the MP4 video is ready ---------- */
let upload = null; // set from recording.js (avoids a circular require)
function useUpload(u) {
  upload = u;
}
async function continueSession(sid) {
  let s = findSession(sid);
  if (!s || !['done', 'captions'].includes(s.status) || !available()) return;
  if (s.captions && s.captions.length && s.captionStatus !== 'done' && s.captionStatus !== 'failed') {
    await overlayText(sid);
    s = findSession(sid);
  }
  if (s && s.code && s.upload === 'processing' && upload) {
    const h = await phoneVersion(sid, upload.videoQuality());
    if (!h || h.error) {
      log.error(`Phone version for QR could not be made (${s.file}): ${h ? h.error : '-'}`);
      updateSession(sid, { upload: 'failed' });
      upload.videoFailed(s.code);
      return;
    }
    updateSession(sid, { upload: 'queued' });
    upload.videoFileReady(s.code, h.file, h.poster);
    log.write(`Phone version ready for QR ${s.code}: ${(fs.statSync(h.file).size / 1048576).toFixed(1)} MB`);
  }
}
const processLater = sid => enqueue(() => continueSession(sid));

// When the app opens: continue work that was interrupted
function start() {
  if (!available()) return;
  for (const s of readSessions()) {
    if (s.status === 'captions') {
      updateSession(s.id, { status: 'done', captionStatus: undefined });
      processLater(s.id);
    } else if (
      s.status === 'done' &&
      ((s.captions && s.captions.length && !s.captionStatus) || s.upload === 'processing')
    )
      processLater(s.id);
  }
  // Clean up temporary files left behind
  try {
    for (const f of fs.readdirSync(CAPTION_DIR)) if (f.endsWith('-chapters.txt')) removeFile(path.join(CAPTION_DIR, f));
  } catch {
    /* the text image folder doesn't exist yet */
  }
}

module.exports = {
  available,
  getFfmpegPath: () => ffmpegPath,
  enqueue,
  runFfmpeg,
  saveCaptions,
  processLater,
  start,
  useUpload,
  phoneFile,
  posterFile,
  PHONE_DIR,
};
