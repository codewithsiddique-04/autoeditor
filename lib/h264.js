// H.264 level selection — pure, no browser APIs, so it's unit-testable.
//
// The browser's VideoEncoder rejects a frame whose size (or size × fps) exceeds
// what the codec string's AVC *level* allows, with:
//   "The provided resolution (WxH) has a coded area (…) which exceeds the maximum
//    coded area (…) supported by the AVC level (4.0) indicated by the codec
//    string (0x28)."
// The old render path fixed the level at 4.0 (…0028) regardless of resolution,
// so every 4K / tall-portrait export died exactly this way. These helpers pick a
// level string that actually fits the frame.

// [levelHex, maxFrameSizeInMacroblocks (MaxFS), maxMacroblocksPerSecond (MaxMBPS)].
// A level must satisfy BOTH the frame area (MaxFS) and the area×fps rate
// (MaxMBPS) — 4K30 needs 5.1, 4K60 needs 5.2, even though their frame size is the
// same. Values are from the H.264 spec, Table A-1. A macroblock is 16×16 px.
export const H264_LEVELS = [
  ["1f", 3600, 108000],     // 3.1  ~720p30
  ["20", 5120, 216000],     // 3.2
  ["28", 8192, 245760],     // 4.0  ~1080p30
  ["2a", 8704, 522240],     // 4.2  ~1080p60
  ["32", 22080, 589824],    // 5.0
  ["33", 36864, 983040],    // 5.1  ~4K30
  ["34", 36864, 2073600],   // 5.2  ~4K60
  ["3c", 139264, 4177920],  // 6.0  ~8K30
  ["3d", 139264, 8355840],  // 6.1
  ["3e", 139264, 16711680], // 6.2  ~8K120
];

// Macroblocks needed to cover width×height (each MB is 16×16, rounded up).
export function frameMacroblocks(width, height) {
  return Math.ceil(Math.max(2, width) / 16) * Math.ceil(Math.max(2, height) / 16);
}

// Lowest H.264 level hex that can encode width×height at fps. If the frame is
// bigger than any standard level (beyond 8K), returns the highest known level —
// the caller is expected to have already downscaled to something sane.
export function h264LevelFor(width, height, fps = 30) {
  const mbs = frameMacroblocks(width, height);
  const rate = mbs * Math.max(1, Math.round(fps) || 30);
  for (const [hex, maxFs, maxMbps] of H264_LEVELS) {
    if (mbs <= maxFs && rate <= maxMbps) return hex;
  }
  return H264_LEVELS[H264_LEVELS.length - 1][0];
}

// Ordered H.264 codec strings to try for a given size: the level that actually
// fits (High profile first, then Main, then Baseline), then the next level up as
// headroom for encoders that want it. We deliberately DON'T enumerate every
// higher level — if the encoder can't handle the frame *area*, the right move is
// to downscale the output, not to keep raising the level.
export function h264CodecCandidates(width, height, fps = 30) {
  const needed = h264LevelFor(width, height, fps);
  const start = Math.max(0, H264_LEVELS.findIndex(([hex]) => hex === needed));
  const levels = H264_LEVELS.slice(start, start + 2).map(([hex]) => hex);
  const out = [];
  for (const lvl of levels) {
    out.push(`avc1.6400${lvl}`); // High profile
    out.push(`avc1.4d00${lvl}`); // Main profile
    out.push(`avc1.4200${lvl}`); // Baseline profile
  }
  return out;
}

// Even (H.264 needs even dimensions), ≥ 2.
export function evenDim(n) {
  return Math.max(2, Math.round(n / 2) * 2);
}

// Scale width×height down to fit a maxW×maxH box, preserving aspect, keeping even
// dimensions. Returns the (even) input unchanged when it already fits.
export function fitWithin(width, height, maxW, maxH) {
  const w = evenDim(width), h = evenDim(height);
  const s = Math.min(1, maxW / w, maxH / h);
  if (s >= 1) return { width: w, height: h };
  return { width: evenDim(w * s), height: evenDim(h * s) };
}

// Candidate output sizes to try, largest first: the requested size (capped to a
// 4K box so we never ask for a frame no consumer level supports), then
// progressively smaller boxes. A device whose encoder can't do 4K then still
// gets a working 1440p/1080p/720p file instead of a failed render.
export function renderSizeCandidates(rawW, rawH) {
  const base = fitWithin(rawW, rawH, 3840, 3840);
  const boxes = [3840, 2560, 1920, 1280];
  const sizes = [];
  const seen = new Set();
  for (const box of boxes) {
    const sz = fitWithin(base.width, base.height, box, box);
    const key = `${sz.width}x${sz.height}`;
    if (sz.width <= base.width && sz.height <= base.height && !seen.has(key)) {
      seen.add(key);
      sizes.push(sz);
    }
  }
  if (!sizes.length) sizes.push(base);
  return sizes;
}
