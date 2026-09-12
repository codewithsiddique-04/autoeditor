// Per-frame canvas atmosphere effects, shared by the preview (Editor.draw) and
// the WebCodecs export. applyEffect() runs after the frame image/transition is
// drawn and before captions/fades. Cheap primitives only (no per-pixel JS loops
// on the full frame): CSS filter via a reusable offscreen, blended overlays, a
// pre-baked noise tile, and a deterministic particle sim.

let SCRATCH = null;
function getScratch(W, H) {
  if (!SCRATCH) {
    SCRATCH = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(W, H)
      : (typeof document !== "undefined" ? document.createElement("canvas") : null);
  }
  if (!SCRATCH) return null;
  if (SCRATCH.width !== W) SCRATCH.width = W;
  if (SCRATCH.height !== H) SCRATCH.height = H;
  return SCRATCH;
}

// Redraw the current canvas through a CSS filter (grayscale / sepia).
function filterSelf(ctx, W, H, filter) {
  const s = getScratch(W, H);
  if (!s) return;
  const sctx = s.getContext("2d");
  sctx.clearRect(0, 0, W, H);
  sctx.drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.filter = filter;
  ctx.drawImage(s, 0, 0);
  ctx.restore();
}

// One 256x256 tile of gray noise, built once (lazily, client-side).
let NOISE = null;
function noiseTile() {
  if (NOISE) return NOISE;
  const hasOC = typeof OffscreenCanvas !== "undefined";
  if (!hasOC && typeof document === "undefined") return null;
  const N = 256;
  const cv = hasOC ? new OffscreenCanvas(N, N) : document.createElement("canvas");
  cv.width = N; cv.height = N;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(N, N);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  NOISE = cv;
  return NOISE;
}

function drawNoise(ctx, W, H, alpha, blend, t) {
  const tile = noiseTile();
  if (!tile) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = blend;
  // t-derived offset so the grain flickers each frame.
  const ox = -((Math.floor(t * 60) * 57) % 256);
  const oy = -((Math.floor(t * 60) * 131) % 256);
  const p = ctx.createPattern(tile, "repeat");
  if (p) {
    ctx.translate(ox, oy);
    ctx.fillStyle = p;
    ctx.fillRect(-ox, -oy, W, H);
  }
  ctx.restore();
}

// Deterministic pseudo-random in [0,1) from an integer seed (so preview == export).
function rnd(seed) { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); }

// Copy the current canvas into the scratch and return it, for effects that need
// to resample the frame (glitch/VHS chroma offsets, slice tears).
function snapshot(ctx, W, H) {
  const s = getScratch(W, H);
  if (!s) return null;
  const sctx = s.getContext("2d");
  sctx.clearRect(0, 0, W, H);
  sctx.drawImage(ctx.canvas, 0, 0);
  return s;
}

// A 1x3 scanline tile (2 clear rows + 1 dark row) for the VHS look, built once.
let SCANLINES = null;
function scanlineTile() {
  if (SCANLINES) return SCANLINES;
  const hasOC = typeof OffscreenCanvas !== "undefined";
  if (!hasOC && typeof document === "undefined") return null;
  const cv = hasOC ? new OffscreenCanvas(1, 3) : document.createElement("canvas");
  cv.width = 1; cv.height = 3;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillRect(0, 2, 1, 1);
  SCANLINES = cv;
  return SCANLINES;
}

// Digital glitch: a faint chromatic ghost + a few t-seeded horizontal slice tears.
function glitch(ctx, W, H, intensity, t) {
  const s = snapshot(ctx, W, H);
  if (!s) return;
  const k = Math.max(0.4, H / 1080);
  // Chromatic ghost: redraw the frame offset both ways, lighten-blended.
  ctx.save();
  ctx.globalCompositeOperation = "lighten";
  ctx.globalAlpha = 0.45;
  const dx = Math.round((2 + intensity * 9) * k);
  ctx.drawImage(s, -dx, 0);
  ctx.drawImage(s, dx, 0);
  ctx.restore();
  // Slice tears: random horizontal bands copied from the snapshot, shifted sideways.
  ctx.save();
  const bucket = Math.floor(t * 12); // ~12 updates/sec, deterministic
  const bands = Math.round(3 + intensity * 8);
  for (let b = 0; b < bands; b++) {
    const y = Math.floor(rnd(bucket * 31 + b * 7) * H);
    const h = Math.max(2, Math.floor((4 + rnd(bucket * 17 + b * 13) * 46) * k));
    const shift = Math.round((rnd(bucket * 53 + b * 3) - 0.5) * 2 * (12 + intensity * 70) * k);
    ctx.clearRect(0, y, W, h);
    ctx.drawImage(s, 0, y, W, h, shift, y, W, h);
  }
  ctx.restore();
}

// VHS/old-tape: chroma bleed + wobble, dark scanlines, and tape noise.
function vhs(ctx, W, H, intensity, t) {
  const s = snapshot(ctx, W, H);
  if (!s) return;
  const k = Math.max(0.4, H / 1080);
  ctx.save();
  ctx.globalCompositeOperation = "lighten";
  ctx.globalAlpha = 0.3 * intensity + 0.1;
  const wob = Math.round((Math.sin(t * 8) * 2 + 2) * k);
  ctx.drawImage(s, wob, 0);
  ctx.restore();
  const sl = scanlineTile();
  if (sl) {
    ctx.save();
    ctx.globalAlpha = 0.4 * intensity + 0.15;
    ctx.globalCompositeOperation = "multiply";
    const p = ctx.createPattern(sl, "repeat");
    if (p) { ctx.fillStyle = p; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }
  drawNoise(ctx, W, H, 0.2 * intensity, "overlay", t);
}

// Warm film light-leak that sweeps across, screen-blended.
function lightleak(ctx, W, H, intensity, t) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const cx = (0.5 + 0.5 * Math.sin(t * 0.5)) * W;
  const a = 0.85 * intensity;
  const g = ctx.createRadialGradient(cx, H * 0.32, 0, cx, H * 0.32, Math.max(W, H) * 0.72);
  g.addColorStop(0, `rgba(255,184,96,${a})`);
  g.addColorStop(0.4, `rgba(255,120,60,${a * 0.5})`);
  g.addColorStop(1, "rgba(255,80,40,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawParticles(ctx, W, H, intensity, t, o) {
  const n = Math.round(o.base * (0.35 + intensity));
  // Radius scales with resolution (px sizes tuned for 1080p) but keeps a floor so
  // the small tile preview still shows a texture.
  const k = Math.max(0.4, H / 1080);
  ctx.save();
  ctx.fillStyle = o.color;
  for (let i = 0; i < n; i++) {
    const sx = rnd(i + 1), sy = rnd(i + 7), sr = rnd(i + 13), ss = rnd(i + 19);
    const speed = o.minSpeed + ss * o.spanSpeed;
    const drift = Math.sin(t * o.drift + i) * o.driftAmp * W;
    const x = (((sx * W + drift) % W) + W) % W;
    const y = ((((sy + t * speed) % 1) + 1) % 1) * H;
    const r = (o.minR + sr * o.spanR) * k;
    ctx.globalAlpha = Math.min(1, o.minA + sr * o.spanA);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function tint(ctx, W, H, color, alpha, blend) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = blend;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function vignette(ctx, W, H, alpha) {
  ctx.save();
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.62);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

export const EFFECTS = {
  none:     { id: "none", label: "None", group: "none", apply: () => {} },
  bw:       { id: "bw", label: "B&W", group: "grade", apply: (c, W, H, i) => filterSelf(c, W, H, `grayscale(${i})`) },
  sepia:    { id: "sepia", label: "Sepia", group: "grade", apply: (c, W, H, i) => filterSelf(c, W, H, `sepia(${i}) contrast(${1 + 0.1 * i})`) },
  warm:     { id: "warm", label: "Warm", group: "grade", apply: (c, W, H, i) => tint(c, W, H, "#ff8a1e", 0.5 * i, "soft-light") },
  cool:     { id: "cool", label: "Cool", group: "grade", apply: (c, W, H, i) => tint(c, W, H, "#1e78ff", 0.5 * i, "soft-light") },
  grain:    { id: "grain", label: "Film grain", group: "grain", apply: (c, W, H, i, t) => drawNoise(c, W, H, 0.22 * i, "overlay", t) },
  noise:    { id: "noise", label: "Heavy noise", group: "grain", apply: (c, W, H, i, t) => drawNoise(c, W, H, 0.5 * i, "soft-light", t) },
  vignette: { id: "vignette", label: "Vignette", group: "vignette", apply: (c, W, H, i) => vignette(c, W, H, 0.7 * i) },
  glitch:   { id: "glitch", label: "Glitch", group: "vintage", apply: (c, W, H, i, t) => glitch(c, W, H, i, t) },
  vhs:      { id: "vhs", label: "VHS", group: "vintage", apply: (c, W, H, i, t) => vhs(c, W, H, i, t) },
  leak:     { id: "leak", label: "Light leak", group: "vintage", apply: (c, W, H, i, t) => lightleak(c, W, H, i, t) },
  snow:     { id: "snow", label: "Snow", group: "particle", apply: (c, W, H, i, t) => drawParticles(c, W, H, i, t, { base: 440, color: "#ffffff", minSpeed: 0.03, spanSpeed: 0.06, drift: 0.6, driftAmp: 0.03, minR: 2.4, spanR: 4.2, minA: 0.6, spanA: 0.4 }) },
  dust:     { id: "dust", label: "Dust", group: "particle", apply: (c, W, H, i, t) => drawParticles(c, W, H, i, t, { base: 300, color: "#e6dcc4", minSpeed: 0.008, spanSpeed: 0.025, drift: 0.4, driftAmp: 0.05, minR: 1.6, spanR: 3.2, minA: 0.35, spanA: 0.5 }) },
};

export const EFFECT_LIST = Object.keys(EFFECTS).map((id) => EFFECTS[id]);

// Apply the selected effect in place on ctx (canvas already has the frame drawn).
// no-op for "none"/unknown. `t` is seconds (drives grain flicker + particles).
export function applyEffect(ctx, id, intensity, W, H, t) {
  const fx = EFFECTS[id];
  if (!fx || id === "none") return;
  const i = Math.max(0, Math.min(1, intensity == null ? 0.5 : intensity));
  fx.apply(ctx, W, H, i, t || 0);
}
