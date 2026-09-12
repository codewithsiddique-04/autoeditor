// SPIKE — WebCodecs GPU render path (video-only, no audio/captions yet).
// Proves the pipeline: draw each frame on an OffscreenCanvas (GPU), feed it
// straight to the device's hardware H.264 encoder via WebCodecs, and mux the
// encoded chunks into a playable .mp4 — no ffmpeg, no giant filtergraph, and
// zoom is a sub-pixel canvas transform (so no supersampling and no shake).
//
// Transitions use the SAME canvas painters as the live preview (lib/transitions),
// with the same timing (a transition plays at the start of the incoming clip, the
// outgoing image frozen at its end-of-clip zoom), so the exported frames match
// what you see in the preview exactly — all 8 types, not just a crossfade.
import { Muxer, StreamTarget, FileSystemWritableFileStreamTarget } from "mp4-muxer";

// Collects muxer output into a list of fixed-size blocks, then a Blob — avoids the
// single-ArrayBuffer size ceiling (~2 GB) that made large MP4s fail at finalize.
class ChunkedBuffer {
  constructor(blockSize = 16 * 1024 * 1024) { this.blockSize = blockSize; this.blocks = []; this.length = 0; }
  write(position, data) {
    const end = position + data.length;
    while (this.blocks.length * this.blockSize < end) this.blocks.push(new Uint8Array(this.blockSize));
    let off = position, srcOff = 0, remaining = data.length;
    while (remaining > 0) {
      const bi = Math.floor(off / this.blockSize), bo = off % this.blockSize;
      const n = Math.min(remaining, this.blockSize - bo);
      this.blocks[bi].set(data.subarray(srcOff, srcOff + n), bo);
      off += n; srcOff += n; remaining -= n;
    }
    if (end > this.length) this.length = end;
  }
  toBlob(type) {
    const parts = [];
    let remaining = this.length;
    for (const b of this.blocks) {
      if (remaining <= 0) break;
      const n = Math.min(remaining, this.blockSize);
      parts.push(n === b.length ? b : b.subarray(0, n));
      remaining -= n;
    }
    return new Blob(parts, { type });
  }
}

import { captionAt, drawCaption, captionFontPx, captionFontFamily } from "./captions";
import { applyEffect } from "./effects";
import { transitionOf } from "./transitions";
import { createVideoSource } from "./videoDecodeSource";
import { createVoiceSource } from "./voiceSource";

// Open a fresh temp file in OPFS to stream the muxed MP4 into, so the output never
// accumulates in RAM. We can't delete the current file until its download finishes
// (unknown timing), so leftover temps from earlier renders are swept here on the next
// run — they all share the `ae-out-` prefix and a unique suffix.
async function openOpfsOutput() {
  const root = await navigator.storage.getDirectory();
  try {
    for await (const name of root.keys()) {
      if (/^ae-out-.*\.mp4$/.test(name)) { try { await root.removeEntry(name); } catch (_) {} }
    }
  } catch (_) {}
  const name = `ae-out-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const handle = await root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  return { writable, handle, name };
}

export function webCodecsSupported() {
  return typeof window !== "undefined"
    && typeof window.VideoEncoder !== "undefined"
    && typeof window.VideoFrame !== "undefined"
    && typeof window.OffscreenCanvas !== "undefined";
}

// Actually configure + encode one frame to confirm a codec works. iOS Safari's
// VideoEncoder.isConfigSupported can wrongly report H.264 as unsupported even though
// encoding works, so this is the ground-truth fallback. Firefox (no H.264 encoder)
// errors here and correctly fails.
async function encodeProbe(codec, width, height, framerate, bitrate) {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined" || typeof OffscreenCanvas === "undefined") return false;
  let enc = null;
  try {
    const W = Math.min(320, width || 320), H = Math.min(240, height || 240);
    const oc = new OffscreenCanvas(W, H);
    const ctx = oc.getContext("2d");
    if (!ctx) return false;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    let got = false, cfg = null, err = null;
    enc = new VideoEncoder({ output: (chunk, meta) => { got = true; if (meta && meta.decoderConfig) cfg = meta.decoderConfig; }, error: (e) => { err = e; } });
    enc.configure({ codec, width: W, height: H, framerate: framerate || 30, bitrate: Math.min(bitrate || 500000, 1_000_000), avc: { format: "avc" } });
    const frame = new VideoFrame(oc, { timestamp: 0 });
    enc.encode(frame, { keyFrame: true });
    frame.close();
    await enc.flush();
    // Require a decoderConfig, not just a chunk: some browsers (certain Firefox builds)
    // report H.264 support and even encode, but emit no decoderConfig — which mp4-muxer
    // needs to write the file, so finalize() would crash. No config → not usable here.
    return got && !err && !!cfg;
  } catch (_) { return false; }
  finally { try { enc && enc.close(); } catch (_) {} }
}

async function videoCodecOk(codec, width, height, framerate, bitrate) {
  // encodeProbe is the ground truth: it confirms a real one-frame encode AND that a
  // decoderConfig actually comes out (needed to mux a playable file). isConfigSupported
  // both false-negatives (iOS Safari) AND false-positives (some Firefox builds report
  // H.264 but emit no decoderConfig), so we don't trust it alone.
  return await encodeProbe(codec, width, height, framerate, bitrate);
}
// Real one-frame AAC encode probe — same reason as encodeProbe: iOS Safari's
// AudioEncoder.isConfigSupported can wrongly report AAC unsupported (which drops audio,
// producing a silent video), even though encoding works.
async function audioEncodeProbe(codec, sampleRate, numberOfChannels) {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return false;
  let enc = null;
  try {
    let got = false, err = null;
    enc = new AudioEncoder({ output: () => { got = true; }, error: (e) => { err = e; } });
    enc.configure({ codec, sampleRate, numberOfChannels, bitrate: 192000 });
    const n = 1024;
    const adata = new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: n, numberOfChannels, timestamp: 0, data: new Float32Array(n * numberOfChannels) });
    enc.encode(adata);
    adata.close();
    await enc.flush();
    return got && !err;
  } catch (_) { return false; }
  finally { try { enc && enc.close(); } catch (_) {} }
}

async function audioCodecOk(codec, sampleRate = 48000, numberOfChannels = 2) {
  if (typeof AudioEncoder === "undefined") return false;
  try { const s = await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels, bitrate: 192000 }); if (s && s.supported) return true; }
  catch (_) { /* fall through to the real encode probe */ }
  return await audioEncodeProbe(codec, sampleRate, numberOfChannels);
}

// Can this browser encode H.264 video? Used to offer the Fast render only where it
// works. Firefox has NO H.264 (or any usable hardware) encoder, so it returns false
// and the app tells the user to use Chrome/Edge/Safari.
export async function webCodecsCanRender() {
  if (!webCodecsSupported() || typeof VideoEncoder === "undefined") return false;
  for (const c of ["avc1.42001f", "avc1.4d0028", "avc1.640028"]) {
    if (await videoCodecOk(c, 640, 480, 30, 1_000_000)) return true;
  }
  return false;
}

// Pick a supported H.264/AAC MP4 profile, capped to 1080p. Returns null if the
// browser can't encode H.264 (e.g. Firefox) — the caller then shows the
// unsupported-browser message.
export async function pickRenderProfile(rawW, rawH, fps = 30, bitrate = 8_000_000) {
  if (!webCodecsSupported()) return null;
  let W = rawW, H = rawH;
  const sc = Math.min(1, 1920 / W, 1080 / H);
  if (sc < 1) { W = Math.max(2, Math.round((W * sc) / 2) * 2); H = Math.max(2, Math.round((H * sc) / 2) * 2); }
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.640033", "avc1.640034", "avc1.42002a", "avc1.42001f"]) {
    if (await videoCodecOk(codec, W, H, fps, bitrate)) {
      // Prefer AAC (most compatible). If the browser can't encode AAC — some Chromebooks /
      // Chromium builds ship no AAC encoder, which was silently producing soundless videos —
      // fall back to Opus (royalty-free, available everywhere) muxed into the same MP4.
      // H.264 + Opus MP4 plays in Chrome, Android and ChromeOS (the browsers that hit this).
      const aac = await audioCodecOk("mp4a.40.2");
      const opus = aac ? false : await audioCodecOk("opus", 48000, 2);
      return { container: "mp4", width: W, height: H, videoCodec: codec, muxerVideo: "avc",
        audioCodec: aac ? "mp4a.40.2" : (opus ? "opus" : null), muxerAudio: aac ? "aac" : "opus" };
    }
  }
  return null;
}

// Pick an H.264 codec string the encoder actually supports at this size. Levels
// ascend so the first supported one is used; the fallback is High@4.0 (handles
// 1080p), never a low level like 3.1 that can't encode the frame.
async function pickCodec(width, height, framerate, bitrate = 8_000_000) {
  const candidates = [
    "avc1.640028", // High L4.0  (1080p)
    "avc1.4d0028", // Main L4.0
    "avc1.640033", // High L5.1  (up to ~4K, if the source is bigger)
    "avc1.640034", // High L5.2
    "avc1.42002a", // Baseline L4.2
    "avc1.42001f", // Baseline L3.1 (last resort, small frames only)
  ];
  for (const codec of candidates) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width, height, framerate, bitrate });
      if (s && s.supported) return codec;
    } catch (_) { /* try next */ }
  }
  return "avc1.4d0028";
}

// Draw a bitmap "contained" (letterboxed) into WxH, zoomed about the centre.
function drawContain(ctx, bmp, W, H, zoom, alpha) {
  if (!bmp) return;
  const iw = bmp.displayWidth || bmp.videoWidth || bmp.naturalWidth || bmp.width;
  const ih = bmp.displayHeight || bmp.videoHeight || bmp.naturalHeight || bmp.height;
  if (!iw || !ih) return;
  const scale = Math.min(W / iw, H / ih) * zoom;
  const dw = iw * scale, dh = ih * scale;
  ctx.globalAlpha = alpha;
  ctx.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.globalAlpha = 1;
}

// spec: { clips:[{name,start,duration}], width, height, fps, transitions[],
//         transitionDuration, motions[], motionAmount }
// imagesByName: { name -> File|Blob }.  onProgress(fraction 0..1).
// Returns an MP4 Blob (video + mixed audio: voiceover and each clip's own audio).

// A yield that a BACKGROUND tab does not throttle. Browsers clamp setTimeout to
// ~1/sec in a hidden tab, which would make the encoder-backpressure waits crawl
// the moment you switch away. MessageChannel tasks keep firing at full speed
// while hidden, so the render keeps running normally in the background.
function makeYield() {
  if (typeof MessageChannel === "undefined") {
    return { tick: () => new Promise((r) => setTimeout(r, 0)), done: () => {} };
  }
  const ch = new MessageChannel();
  const waiters = [];
  ch.port1.onmessage = () => { const w = waiters.shift(); if (w) w(); };
  return {
    tick: () => new Promise((res) => { waiters.push(res); ch.port2.postMessage(0); }),
    done: () => { try { ch.port1.close(); ch.port2.close(); } catch (_) {} },
  };
}

// Keep the tab exempt from background throttling for the whole render by emitting
// (essentially inaudible) audio. IMPORTANT: a *muted* element does NOT work — the
// browser only exempts tabs that output audible sound, so muting/gain-0 gets it
// throttled like any hidden tab. We use a real oscillator at a tiny gain and a
// sub-bass frequency: inaudible on normal output, but genuinely "playing audio",
// which keeps ALL of the page's timers running (even past the 5-min intensive-
// throttling cutoff). Must be started from a user gesture (the render click).
// Returns a stop() to call when the render ends.
export function startKeepAwake() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return () => {};
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.0015; // ~ -56 dB: inaudible in practice, but non-zero
    osc.frequency.value = 20;  // sub-bass; no audible tone on normal speakers
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return () => { try { osc.stop(); } catch (_) {} try { ctx.close(); } catch (_) {} };
  } catch (_) { return () => {}; }
}

// Pitch-preserving time-stretch (WSOLA: windowed overlap-add with a small
// cross-correlation search for the best splice point). `speed` > 1 compresses
// (shorter/faster), < 1 expands — the PITCH is preserved, unlike a raw
// playbackRate. `channels`: Float32Array[] at one sample rate; returns new
// Float32Array[] of length ≈ inLen/speed. This is the atempo equivalent so a
// fit-sped video clip's audio doesn't chipmunk.
function timeStretch(channels, speed) {
  const nCh = channels.length;
  const inLen = nCh ? channels[0].length : 0;
  if (!nCh || !inLen || Math.abs(speed - 1) < 1e-3) return channels.map((c) => c.slice());
  const outLen = Math.max(1, Math.round(inLen / speed));
  let N = 1024;                              // analysis/synthesis window
  if (inLen < 2 * N) N = Math.max(128, Math.floor(inLen / 2));
  N -= N % 2;
  if (N < 8) return channels.map((c) => c.slice(0, outLen)); // too short to stretch
  const Hs = N >> 1;                         // synthesis hop (50% overlap)
  const Ha = Hs * speed;                     // analysis hop
  const SEARCH = Math.min(256, Hs);          // splice-point search radius
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const ref = channels[0];                   // correlate on ch0, splice all channels alike
  const out = [];
  for (let c = 0; c < nCh; c++) out.push(new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  let synPos = 0, frame = 0, prevStart = 0;
  while (synPos < outLen) {
    const ideal = Math.round(frame * Ha);
    let anaStart = ideal;
    if (frame > 0) {
      const target = prevStart + Hs;         // where the last frame naturally continues
      let best = -Infinity, bestOff = 0;
      for (let off = -SEARCH; off <= SEARCH; off++) {
        const a = ideal + off;
        if (a < 0 || a + Hs > inLen || target + Hs > inLen) continue;
        let corr = 0;
        for (let k = 0; k < Hs; k += 4) corr += ref[target + k] * ref[a + k];
        if (corr > best) { best = corr; bestOff = off; }
      }
      anaStart = ideal + bestOff;
    }
    if (anaStart < 0) anaStart = 0;
    if (anaStart + N > inLen) anaStart = inLen - N;
    if (anaStart < 0) break;
    for (let c = 0; c < nCh; c++) {
      const ch = channels[c], o = out[c];
      for (let i = 0; i < N; i++) o[synPos + i] += ch[anaStart + i] * win[i];
    }
    for (let i = 0; i < N; i++) norm[synPos + i] += win[i];
    prevStart = anaStart;
    synPos += Hs;
    frame++;
  }
  const res = [];
  for (let c = 0; c < nCh; c++) {
    const o = out[c];
    for (let i = 0; i < outLen; i++) { const g = norm[i]; if (g > 1e-6) o[i] /= g; }
    res.push(o.subarray(0, outLen));
  }
  return res;
}

export async function renderWebCodecs(spec, imagesByName, onProgress, shouldCancel, logs = [], writable = null) {
  // Diagnostics collected as we go, so a failure dialog can show what happened.
  const log = (m) => { try { logs.push(m); } catch (_) {} };
  // Progress is split into phases: video 0–0.9, audio 0.9–0.98, muxing 0.98–1.
  const report = (frac, phase) => { if (onProgress) onProgress(Math.max(0, Math.min(1, frac)), phase); };
  const bail = () => {
    if (shouldCancel && shouldCancel()) { const e = new Error("Render cancelled"); e.cancelled = true; throw e; }
  };
  if (!webCodecsSupported()) throw new Error("WebCodecs isn't supported in this browser.");
  const { clips, fps = 30, transitions = [], transitionDuration = 0.4, motions = [], motionAmount = 0.08, audioFile = null,
    cues = null, captionStyle = "classic", captionSize = "md", captionLineHeight = 0, captionFontScale = 1,
    captionFont = "default", captionPosition = "bottom",
    effectId = "none", effectIntensity = 0.5,
    videosByName = {}, trims = [], speeds = [], volumes = [], bitrate = 8_000_000 } = spec;
  // The render profile decides container + codecs (H.264/AAC MP4, or VP9/Opus WebM
  // for browsers like Firefox) and caps the resolution to 1080p.
  const profile = spec.profile || (await pickRenderProfile(spec.width, spec.height, fps, bitrate));
  if (!profile) throw new Error("This browser can't encode video with WebCodecs.");
  const W = profile.width, H = profile.height;
  const isVideo = (i) => i >= 0 && i < clips.length && Object.prototype.hasOwnProperty.call(videosByName, clips[i].name);
  if (!clips || !clips.length) throw new Error("Nothing to render.");
  const total = clips[clips.length - 1].start + clips[clips.length - 1].duration;
  const totalFrames = Math.max(1, Math.round(total * fps));
  const yielder = makeYield(); // background-tab-safe yield (see makeYield above)

  // Audio: mix the voiceover with each video clip's OWN audio (placed at the
  // clip's start, scaled by its volume, and sped by its fit-speed). We decide the
  // track config up front so the muxer can be created with it; the actual mix is
  // rendered (via OfflineAudioContext) after the video frames.
  const clipAudio = clips.map((c, i) => (isVideo(i) && (volumes[i] || 0) > 0)
    ? { file: videosByName[c.name], start: c.start, dur: c.duration, offset: trims[i] || 0, speed: speeds[i] || 1, vol: volumes[i] }
    : null).filter(Boolean);
  // Streaming voiceover: WAV is read straight from the file, other formats are decoded
  // once and offloaded to disk (OPFS) — so the full decoded track never sits in memory
  // during the video encode (see voiceSource.js).
  // Opus only accepts 48 kHz here; AAC also takes 44.1 kHz. Force the source to a rate the
  // chosen audio codec supports so the encoder configures cleanly.
  const audioAllowedRates = profile.audioCodec === "opus" ? [48000] : [48000, 44100];
  let voiceSource = null;
  if (audioFile) { try { voiceSource = await createVoiceSource(audioFile, audioAllowedRates); } catch (_) { voiceSource = null; } }
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const mixRate = voiceSource ? voiceSource.sampleRate : 48000;
  const mixChannels = 2;
  // The profile already probed audio support (AAC for MP4 / Opus for WebM). A
  // clean video-only file is the fallback when the browser can't encode audio.
  const audioCodec = profile.audioCodec; // WebCodecs config string, or null
  const wantAudio = !!audioCodec && (!!voiceSource || (clipAudio.length > 0 && !!OAC));
  log(`profile: ${profile.container} ${profile.videoCodec}${audioCodec ? " + " + audioCodec : " (no audio)"}`);
  // The project has audio but the browser can't encode any (no AAC *and* no Opus) — surface
  // it so the user isn't handed a silent file with no explanation.
  if (!audioCodec && (audioFile || clipAudio.length > 0)) log("audio failed: this browser has no audio encoder (AAC or Opus) — the video will be silent");

  // Pre-decode each video clip's audio into a SMALL owned buffer (its trimmed, speed-
  // fitted region), placed at the clip's start sample. We deliberately do NOT build one
  // full-length mix buffer here — that ~600 MB allocation, on top of the finished video
  // already held in memory, is what made big renders drop their audio on low-memory
  // browsers (iOS Safari). Instead the encode loop below mixes these into short windows
  // on the fly. Copying each region with Float32Array.from lets the big per-clip decode
  // (cbuf) be freed immediately, so peak audio memory stays tiny.
  async function prepareClipMixes() {
    const out = [];
    if (!clipAudio.length) return out;
    const dctx = new OAC(1, 1, mixRate); // tiny context, reused only to decode+resample
    for (const ca of clipAudio) {
      let cbuf = null;
      try { cbuf = await dctx.decodeAudioData(await ca.file.arrayBuffer()); }
      catch (_) { cbuf = null; } // clip may have no audio track
      if (!cbuf) continue;
      const nCh = Math.min(mixChannels, cbuf.numberOfChannels);
      const startSample = Math.max(0, Math.floor(ca.offset * mixRate));
      const regionLen = Math.min(cbuf.length - startSample, Math.round(ca.dur * ca.speed * mixRate));
      if (regionLen <= 0) continue;
      const region = [];
      for (let c = 0; c < nCh; c++) region.push(cbuf.getChannelData(c).subarray(startSample, startSample + regionLen));
      // Pitch-preserving fit-speed: pre-stretch to the slot length, then own the result.
      const stretched = Math.abs(ca.speed - 1) < 1e-3 ? region : timeStretch(region, ca.speed);
      const chans = stretched.map((s) => Float32Array.from(s)); // copy → releases cbuf
      out.push({ chans, at: Math.floor(ca.start * mixRate), vol: ca.vol });
    }
    return out;
  }

  // Decode images ON DEMAND, keeping only a few near the playhead, so a long
  // timeline of large images doesn't exhaust the tab's memory (and crash it).
  const cache = new Map(); // clip index -> ImageBitmap|null
  async function getBmp(i) {
    if (i < 0 || i >= clips.length) return null;
    if (cache.has(i)) return cache.get(i);
    const file = imagesByName[clips[i].name];
    const bmp = file ? await createImageBitmap(file) : null;
    cache.set(i, bmp);
    for (const [k, b] of cache) { if (Math.abs(k - i) > 2) { if (b && b.close) b.close(); cache.delete(k); } }
    return bmp;
  }

  // Video clips: one muted offscreen <video> each, advanced to the source time this
  // output frame needs (mirrors the ffmpeg render's trim/speed). The fast path decodes
  // via VideoDecoder; the fallback plays the clip forward (see createPlaybackController).
  const videoEls = new Map(); // clip index -> { v, url } | null
  async function getVideoEl(i) {
    if (videoEls.has(i)) return videoEls.get(i);
    const file = videosByName[clips[i].name];
    if (!file) { videoEls.set(i, null); return null; }
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto";
    const url = URL.createObjectURL(file);
    v.src = url;
    await new Promise((res) => {
      const done = () => { v.removeEventListener("loadeddata", done); v.removeEventListener("error", done); res(); };
      v.addEventListener("loadeddata", done);
      v.addEventListener("error", done);
      try { v.load(); } catch (_) { done(); }
    });
    const entry = { v, url };
    videoEls.set(i, entry);
    return entry;
  }
  function seekTo(v, time) {
    return new Promise((resolve) => {
      const eps = 1 / (fps * 4);
      if (v.readyState >= 2 && Math.abs(v.currentTime - time) <= eps) { resolve(); return; }
      let settled = false;
      const done = () => { if (settled) return; settled = true; v.removeEventListener("seeked", done); resolve(); };
      v.addEventListener("seeked", done);
      try { v.currentTime = time; } catch (_) { done(); }
    });
  }
  // Fallback frame source that plays the clip STRAIGHT THROUGH instead of seeking to
  // each frame. Seeking rebuilds every frame from the nearest keyframe — thousands of
  // times over a clip — which is what makes the seek path crawl on mobile. Playing
  // forward decodes sequentially (one smooth pass). A short leash pauses playback when
  // it runs past what the render currently needs, so a slow encoder can't let the clip
  // race ahead and desync; big jumps / rewinds (e.g. a trim start) still use one seek.
  function createPlaybackController(v) {
    const eps = 1 / (fps * 2);
    const leash = 3 / fps;
    let want = 0, disposed = false;
    const hasRVFC = typeof v.requestVideoFrameCallback === "function";
    const leashCheck = () => { if (!disposed && !v.paused && v.currentTime > want + leash) { try { v.pause(); } catch (_) {} } };
    if (hasRVFC) {
      const onFrame = () => { if (disposed) return; leashCheck(); v.requestVideoFrameCallback(onFrame); };
      v.requestVideoFrameCallback(onFrame);
    } else {
      const iv = setInterval(() => { if (disposed) { clearInterval(iv); return; } leashCheck(); }, 8);
    }
    async function frameAt(src) {
      want = src;
      // Backward, or a jump too large to reach by playing → a single seek is cheaper.
      if (src < v.currentTime - eps || src - v.currentTime > 0.5) { await seekTo(v, src); return v; }
      if (v.currentTime >= src - eps) return v; // playback already reached this time
      if (v.paused) { try { await v.play(); } catch (_) { await seekTo(v, src); return v; } }
      await new Promise((resolve) => {
        const check = () => { if (disposed || v.ended || v.currentTime >= src - eps) resolve(); else setTimeout(check, 6); };
        check();
      });
      return v;
    }
    function dispose() { disposed = true; try { v.pause(); } catch (_) {} }
    return { frameAt, dispose };
  }
  // Fast path: decode each video clip sequentially with a hardware VideoDecoder
  // (no per-frame seeking). Falls back to the <video> playback path above if a clip
  // can't be decoded that way (unsupported codec, demux failure, …).
  const videoSources = new Map(); // clip index -> source | null (null = use seek)
  async function getVideoSource(i) {
    if (videoSources.has(i)) return videoSources.get(i);
    let src = null;
    try { src = await createVideoSource(videosByName[clips[i].name]); } catch (_) { src = null; }
    videoSources.set(i, src);
    log(`clip ${i}: ${src ? "VideoDecoder (fast)" : "<video> playback (fallback)"}`);
    return src;
  }
  // A drawable for clip i at output time t. Video clips decode sequentially (or
  // fall back to seeking); images return their time-independent ImageBitmap.
  async function getFrame(i, t) {
    if (i < 0 || i >= clips.length) return null;
    if (!isVideo(i)) return getBmp(i);
    const c = clips[i];
    const speed = speeds[i] || 1;
    const trimStart = trims[i] || 0;
    const src = trimStart + Math.max(0, t - c.start) * speed; // monotonic per clip
    const source = await getVideoSource(i);
    if (source) {
      try { const fr = await source.frameAt(src); if (fr) return fr; } catch (_) { /* fall back */ }
    }
    const entry = await getVideoEl(i);
    if (!entry) return null;
    const dur = entry.v.duration || 0;
    const clamped = Math.max(0, Math.min(dur ? dur - 1e-3 : 0, src));
    if (!entry.ctrl) entry.ctrl = createPlaybackController(entry.v);
    return await entry.ctrl.frameAt(clamped);
  }

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d", { alpha: false });

  // Captions: precompute the font size and make sure the caption font is loaded
  // (the main-thread OffscreenCanvas shares the document's fonts).
  const hasCaptions = !!(cues && cues.length);
  const capFontPx = captionFontPx(H, captionSize, captionFontScale);
  const capFamily = captionFontFamily(captionFont);
  if (hasCaptions && typeof document !== "undefined" && document.fonts) {
    try { await document.fonts.load(`700 ${capFontPx}px "${capFamily}"`); } catch (_) {}
    if (capFamily !== "CaptionFont") { try { await document.fonts.load(`700 ${capFontPx}px "CaptionFont"`); } catch (_) {} }
  }

  // Output target — three modes:
  //   • iOS/WebKit: stream a FRAGMENTED (fMP4) file to a temp file in OPFS, so the MP4
  //     never accumulates in RAM. WebKit reloads the whole tab (losing the render) once a
  //     page's memory crosses its ceiling, and a ~1 GB in-RAM MP4 trips it. Fragments are
  //     appended forward with NO backward header seek — that seek, through an OPFS
  //     writable, is what corrupted earlier (fastStart:false) attempts. Fragmented mode
  //     REQUIRES video+audio fed interleaved by time (done in the loop below), otherwise
  //     the muxer holds the whole video in its sample queue — same blow-up we're avoiding.
  //   • External writable (a caller passes one): stream fastStart:false.
  //   • Otherwise (desktop): assemble a standard MP4 in an in-memory ChunkedBuffer → Blob.
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isWebKit = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && /Version\/.*Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg/.test(ua));
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const canOPFS = typeof navigator !== "undefined" && navigator.storage && !!navigator.storage.getDirectory;
  // Mobile (iOS + Android) streams the fragmented MP4 to an OPFS temp file so the output
  // never accumulates in RAM. iOS needs it because WebKit reloads the tab past a memory
  // ceiling; Android gets the same path here so its fragmented output is exercised too.
  // (Desktop keeps the in-memory standard-MP4 path.)
  let chunkedBuf = null, target, opfsOut = null;
  if (!writable && (isIOS || isAndroid)) {
    const tag = isIOS ? "ios" : "android";
    const warn = isIOS ? " (tab may reload on long renders)" : "";
    if (!canOPFS) {
      log(`${tag}: OPFS not available — in-memory buffer${warn}`);
    } else {
      try { opfsOut = await openOpfsOutput(); }
      catch (e) { opfsOut = null; log(`${tag}: OPFS output failed (${e && e.message ? e.message : e}) — in-memory buffer${warn}`); }
    }
  }
  const streamToDisk = !!opfsOut;   // fragmented streaming to our own OPFS temp
  const fragmented = streamToDisk;
  // Effective bitrate. A streamed output (to disk / a caller's file) has no size limit, so
  // it keeps the full requested rate. An in-memory output must fit the whole MP4 in RAM, so
  // for long videos it's capped by a memory budget (iOS and ≤4 GB devices get the tighter
  // tier). Decided HERE — after we know streaming actually engaged — so a fallback to the
  // in-memory buffer (e.g. OPFS unavailable) doesn't leave us with a too-large RAM buffer.
  const lowMem = isIOS || (typeof navigator !== "undefined" && navigator.deviceMemory && navigator.deviceMemory <= 4);
  const memCap = lowMem ? 550e6 : 1_150e6;
  const effBitrate = (streamToDisk || writable)
    ? bitrate
    : Math.max(2_000_000, Math.min(bitrate, Math.floor((memCap * 8) / Math.max(1, total))));
  // Prefer CRF-like constant-quantizer encoding when the browser supports it: the encoder
  // spends bits by QUALITY instead of filling a fixed bitrate, so near-static slideshow
  // content produces far smaller files (like the ffmpeg CRF path) with no visible loss,
  // while real motion still gets the bits it needs. Where 'quantizer' isn't supported
  // (e.g. Safari/iOS) it falls back to bitrate mode with the memory-safe effBitrate.
  const QP = 26; // H.264 quantizer, 0–51; lower = higher quality/bigger. ~ffmpeg CRF 23.
  let useQuantizer = false;
  // Skip quantizer on low-memory (in-memory-output) devices: it has no bitrate ceiling, so
  // a heavy timeline can bloat the RAM buffer and cause the GC stalls that get the encoder
  // reclaimed. There they use bitrate mode with the memory-safe effBitrate instead.
  if (!(lowMem && !streamToDisk && !writable)) {
    try {
      const q = await VideoEncoder.isConfigSupported({ codec: profile.videoCodec, width: W, height: H, framerate: fps, bitrateMode: "quantizer", avc: { format: "avc" } });
      useQuantizer = !!(q && q.supported);
    } catch (_) { useQuantizer = false; }
  }
  if (streamToDisk) {
    target = new FileSystemWritableFileStreamTarget(opfsOut.writable);
  } else if (writable) {
    target = new FileSystemWritableFileStreamTarget(writable);
  } else {
    chunkedBuf = new ChunkedBuffer();
    target = new StreamTarget({ onData: (data, position) => chunkedBuf.write(position, data) });
  }
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: W, height: H },
    ...(wantAudio ? { audio: { codec: profile.muxerAudio, sampleRate: mixRate, numberOfChannels: mixChannels } } : {}),
    fastStart: fragmented ? "fragmented" : false,
  });
  log(streamToDisk ? "output: fragmented mp4 → OPFS (streaming)" : (writable ? "output: streaming to file" : "output: chunked buffer"));
  log(`video ${W}x${H} @ ${fps}fps, ${total.toFixed(1)}s, ${totalFrames} frames, codec ${profile.videoCodec}, ${useQuantizer ? `quality mode (QP ${QP})` : `bitrate ${(effBitrate / 1e6).toFixed(1)} Mbps${effBitrate < bitrate ? " (capped for in-memory output)" : ""}`}`);
  log(`audio: ${wantAudio ? `${mixRate}Hz ${mixChannels}ch — ${voiceSource ? "voiceover" : "no voiceover"}, ${clipAudio.length} clip track(s)` : "none"}`);
  let encErr = null, reclaimed = false;
  // A codec Chrome "reclaimed due to inactivity" (weak machine starves it between encodes)
  // — or otherwise closed under load — is RECOVERABLE: recreate it and continue with a
  // keyframe, rather than failing the whole render.
  const isReclaim = (e) => { const m = ((e && (e.message || e.name)) || "").toString().toLowerCase(); return m.includes("reclaim") || m.includes("inactiv") || m.includes("closed codec") || m.includes("invalidstate"); };
  const makeVideoEncoder = () => {
    const enc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { if (isReclaim(e)) { reclaimed = true; log("video encoder reclaimed — recreating"); } else { encErr = e; log(`video encoder error: ${e && e.message ? e.message : e}`); } },
    });
    enc.configure({ codec: profile.videoCodec, width: W, height: H, framerate: fps, ...(useQuantizer ? { bitrateMode: "quantizer" } : { bitrate: effBitrate }), avc: { format: "avc" } });
    return enc;
  };
  let encoder = makeVideoEncoder();
  // WebKit (Safari / any iOS browser) abandons a single long encode session ("Encoding
  // task did not complete"). Recreate the encoder every SEG frames so no session runs
  // long enough to give up; the muxer stitches the segments into one file (each segment
  // boundary is a keyframe, timestamps stay continuous). Chromium keeps one session.
  const kf = Math.max(1, fps * 2);                                 // keyframe interval
  const winFrames = kf;                                            // interleave window = one keyframe span (~2 s)
  const SEG = isWebKit ? Math.max(kf, Math.round((fps * 120) / kf) * kf) : Infinity; // ~2 min, keyframe-aligned
  if (isWebKit) log(`webkit: segmenting encode every ${SEG} frames`);

  // Audio is mixed + encoded INTERLEAVED with the video (a window at a time), not in a
  // separate pass afterwards. Interleaving keeps the muxer's per-track sample queue to
  // ~one fragment, which is what makes fragmented streaming stay flat in RAM; for the
  // in-memory path the final file is unchanged (each track stays monotonic). The audio
  // encoder has its OWN error channel (audioErr) so an audio failure is non-fatal — the
  // finished video still saves — while a video-encoder error stays fatal via encErr.
  const sampleRate = mixRate, channels = mixChannels;
  const totalSamples = wantAudio ? Math.max(1, Math.ceil(total * sampleRate)) : 0;
  const AUDIO_STEP = 4096;                                         // samples per AudioData chunk
  let audioEnc = null, audioErr = null, audioOff = 0, aChunks = 0, audioDead = !wantAudio, clipMixes = [];
  if (wantAudio) {
    try { clipMixes = await prepareClipMixes(); } catch (_) { clipMixes = []; }
    if (!voiceSource && !clipMixes.length) {
      audioDead = true;
      log("no audio to encode (video-only track)");
    } else {
      try {
        audioEnc = new AudioEncoder({ output: (c, m) => { aChunks++; muxer.addAudioChunk(c, m); }, error: (e) => { audioErr = e; log(`audio encoder error: ${e && e.message ? e.message : e}`); } });
        audioEnc.configure({ codec: audioCodec, sampleRate, numberOfChannels: channels, bitrate: 192000 });
      } catch (e) { audioEnc = null; audioDead = true; log(`audio failed to start (${e && e.message ? e.message : e}) — video-only`); }
    }
  }
  // Kill the audio track without failing the render: an audio problem must never throw
  // away an already-finished video (a user cancel still propagates). From here on,
  // `audioEnc === null` is the single "audio is done/dead" signal.
  function dropAudio(e, note) {
    if (e && e.cancelled) throw e;
    log(`audio failed (${e && e.message ? e.message : e}) — ${note}`);
    audioDead = true; audioEnc = null; audioErr = null;
  }
  // Encode every audio window up to sample `upto` (exclusive). Called at each video-window
  // boundary so audio advances in step with the video. Non-fatal on failure: disables
  // further audio and keeps the finished video.
  async function pumpAudioTo(upto) {
    if (!audioEnc) return;
    upto = Math.min(upto, totalSamples);
    try {
      while (audioOff < upto) {
        if (audioErr) throw audioErr;
        bail();
        const n = Math.min(AUDIO_STEP, upto - audioOff);
        const planar = new Float32Array(n * channels);             // f32-planar: [ch0…, ch1…]
        if (voiceSource) {
          const vwin = await voiceSource.read(audioOff, n);
          for (let c = 0; c < channels; c++) planar.set(vwin[Math.min(c, vwin.length - 1)], c * n);
        }
        for (const cm of clipMixes) {
          const cs = cm.at, ce = cm.at + cm.chans[0].length;
          if (ce <= audioOff || cs >= audioOff + n) continue;      // no overlap with [audioOff, audioOff+n)
          const lo = Math.max(audioOff, cs), hi = Math.min(audioOff + n, ce);
          for (let c = 0; c < channels; c++) {
            const s = cm.chans[Math.min(c, cm.chans.length - 1)];
            const base = c * n;
            for (let gi = lo; gi < hi; gi++) planar[base + (gi - audioOff)] += s[gi - cs] * cm.vol;
          }
        }
        const adata = new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((audioOff / sampleRate) * 1e6), data: planar });
        audioEnc.encode(adata);
        adata.close();
        audioOff += n;
        while (audioEnc.encodeQueueSize > 8) { if (audioErr) throw audioErr; bail(); await yielder.tick(); }
      }
    } catch (e) {
      dropAudio(e, "continuing video-only"); // keep the finished video
    }
  }

  // Ken Burns zoom — identical to the preview's scaleAt: gaps never zoom, and
  // progress is clamped so an outgoing image holds its end-of-clip zoom through a
  // transition (evaluated at the current time t, not a local progress).
  const scaleAt = (i, tt) => {
    const c = clips[i];
    if (!c || c.gap) return 1;
    const m = motions[i];
    if (!m || m === "none") return 1;
    const lp = Math.min(1, Math.max(0, (tt - c.start) / c.duration));
    return m === "zoomout" ? 1 + motionAmount * (1 - lp) : 1 + motionAmount * lp;
  };

  for (let f = 0; f < totalFrames; f++) {
    if (encErr) throw encErr;
    bail();
    // Segment boundary (WebKit): drain and swap in a fresh encoder so no single session
    // runs long enough to be abandoned. The muxer keeps stitching into one file.
    if (f > 0 && f % SEG === 0) {
      await encoder.flush();
      if (encErr) throw encErr;
      try { encoder.close(); } catch (_) {}
      encoder = makeVideoEncoder();
    }
    // Backpressure: never queue frames faster than the encoder drains them, or
    // pending frames + encoded chunks pile up in memory and the tab crashes.
    while (encoder.encodeQueueSize > 4) { if (encErr) throw encErr; if (reclaimed) break; bail(); await yielder.tick(); }

    const t = f / fps;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    // Current clip: the one whose [start, start+duration) contains t (else the last).
    let idx = -1;
    for (let i = 0; i < clips.length; i++) {
      if (t >= clips[i].start && t < clips[i].start + clips[i].duration) { idx = i; break; }
    }
    if (idx === -1) idx = clips.length - 1;
    // Free the hardware decoder of clips we've moved past (access is monotonic).
    for (const [k, s] of videoSources) { if (s && s.close && k < idx - 1) { try { s.close(); } catch (_) {} videoSources.set(k, null); } }
    const clip = clips[idx];
    const type = idx > 0 ? (transitions[idx] || "cut") : "cut";
    const tdur = type === "cut" ? 0 : Math.min(transitionDuration, clip.duration);

    if (idx > 0 && tdur > 0 && t < clip.start + tdur) {
      // Inside a transition: blend previous image -> current with the exact painter
      // the preview uses, each drawn at its own current zoom. (getBmp(idx-1) then
      // getBmp(idx): both stay in the ±2 cache window, so neither is evicted.)
      const p = Math.min(1, Math.max(0, (t - clip.start) / tdur));
      const prevFrame = await getFrame(idx - 1, t);
      const curFrame = await getFrame(idx, t);
      transitionOf(type).canvas(ctx, prevFrame, curFrame, p, W, H, scaleAt(idx - 1, t), scaleAt(idx, t));
      ctx.globalAlpha = 1;
    } else {
      drawContain(ctx, await getFrame(idx, t), W, H, scaleAt(idx, t), 1);
    }

    // Atmosphere effect over the frame (before captions so captions stay crisp).
    applyEffect(ctx, effectId, effectIntensity, W, H, t);

    // Captions drawn on top of the images.
    if (hasCaptions) {
      const cap = captionAt(cues, t);
      if (cap) drawCaption(ctx, cap, W, H, captionStyle, capFontPx, captionLineHeight, capFamily, captionPosition);
    }

    // Recover a reclaimed/closed encoder: swap in a fresh one and force this frame to be a
    // keyframe so the muxed stream stays valid (same swap the WebKit segmenting does).
    let keyFrame = f % kf === 0 || f % SEG === 0;
    if (reclaimed) { try { encoder.close(); } catch (_) {} encoder = makeVideoEncoder(); reclaimed = false; keyFrame = true; }
    const frame = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
    try {
      encoder.encode(frame, { keyFrame, ...(useQuantizer ? { avc: { quantizer: QP } } : {}) }); // segment starts must be keyframes
    } catch (e) {
      if (!isReclaim(e)) { try { frame.close(); } catch (_) {} throw e; }
      try { encoder.close(); } catch (_) {}
      encoder = makeVideoEncoder(); reclaimed = false;
      encoder.encode(frame, { keyFrame: true, ...(useQuantizer ? { avc: { quantizer: QP } } : {}) });
    }
    frame.close();

    // Window boundary: encode this window's audio so it tracks the video in time. When
    // streaming fragmented to disk, drain the video encoder BEFORE the matching audio so
    // the muxer only holds ~one window of video in its queue; the audio then catches up
    // and the fragment flushes to disk — RAM stays flat regardless of length.
    if ((f + 1) % winFrames === 0) {
      if (fragmented) { await encoder.flush(); if (encErr) throw encErr; }
      await pumpAudioTo(Math.ceil(((f + 1) / fps) * sampleRate));
      if (fragmented && audioEnc) {
        try { await audioEnc.flush(); } catch (e) { dropAudio(e, "continuing video-only"); }
      }
    }

    if (f % 8 === 0) report(0.95 * (f / totalFrames), "Rendering");
  }

  await encoder.flush();
  if (encErr) throw encErr;
  try { encoder.close(); } catch (_) {}
  log("video frames encoded");

  // Finish any remaining audio (the final partial window) and drain the audio encoder.
  // Audio is otherwise encoded interleaved with the video, window by window, above.
  if (audioEnc) {
    report(0.96, "Finalizing audio");
    await pumpAudioTo(totalSamples);
    if (audioEnc) {
      try { await audioEnc.flush(); } catch (e) { dropAudio(e, "finalizing video-only"); }
    }
  }
  if (wantAudio) log(`audio encoded: ${aChunks} chunk(s)${aChunks === 0 && !audioDead ? " — WARNING: encoder produced no audio" : ""}`);
  try { if (audioEnc) audioEnc.close(); } catch (_) {}

  report(0.98, "Muxing");
  muxer.finalize();
  for (const b of cache.values()) if (b && b.close) b.close();
  for (const e of videoEls.values()) { if (e && e.ctrl) { try { e.ctrl.dispose(); } catch (_) {} } if (e && e.v) { try { e.v.pause(); e.v.removeAttribute("src"); e.v.load(); } catch (_) {} } if (e && e.url) { try { URL.revokeObjectURL(e.url); } catch (_) {} } }
  for (const s of videoSources.values()) { if (s && s.close) { try { s.close(); } catch (_) {} } }
  if (voiceSource && voiceSource.dispose) { try { await voiceSource.dispose(); } catch (_) {} }
  yielder.done();
  if (streamToDisk) {
    await opfsOut.writable.close();
    const file = await opfsOut.handle.getFile(); // disk-backed File — not read into RAM
    log(`done: ${(file.size / (1024 * 1024)).toFixed(1)} MB (streamed to disk)`);
    report(1, "Done");
    return file; // caller downloads it straight from disk; the temp is swept next render
  }
  if (writable) {
    await writable.close();
    log("done: saved to file");
    report(1, "Done");
    return null; // already written to the caller's file
  }
  const blob = chunkedBuf.toBlob("video/mp4");
  log(`done: ${(blob.size / (1024 * 1024)).toFixed(1)} MB`);
  report(1, "Done");
  return blob;
}
