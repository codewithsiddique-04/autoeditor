# Effects Tab Implementation Plan (Spec #4)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) tracking.

**Goal:** Fill the Effects tab with a global atmosphere effect (color grades, film grain, vignette, particles) + intensity, rendered by a shared `applyEffect()` so preview and export match.

**Architecture:** New `lib/effects.js` (per-frame canvas post-process) called at one spot in `Editor.draw()` and the mirror spot in `webcodecsRender.js`; two new global settings (`effectId`, `effectIntensity`) threaded through `page.js` → `Editor` → `EffectsPanel`; an `EffectTile` grid mirroring `TransitionTile`.

**Verification:** `npx vitest run` (must stay 41 passed) + the **live dev server** (curl `http://localhost:3000/` → 200; read its task output for `✓ Compiled`/errors). **Do NOT run `next build` while dev is running** (shared `.next/` corrupts). Full `next build` only in the final task, with dev stopped.

Effect set: `none, bw, warm, cool, sepia, grain, noise, vignette, snow, dust`.

---

### Task 1: `lib/effects.js`

**File:** Create `lib/effects.js`

- [ ] Implement the module. Every effect wraps its work in `ctx.save()/restore()`. Grain uses a lazily-built noise tile; particles are deterministic from `t`.

```js
// Per-frame canvas atmosphere effects, shared by the preview (Editor.draw) and
// the WebCodecs export. applyEffect() runs after the frame image/transition is
// drawn and before captions/fades. Cheap primitives only (no per-pixel JS loops).

let SCRATCH = null;
function getScratch(W, H) {
  if (!SCRATCH) { SCRATCH = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : (typeof document !== "undefined" ? document.createElement("canvas") : null); }
  if (!SCRATCH) return null;
  if (SCRATCH.width !== W) SCRATCH.width = W;
  if (SCRATCH.height !== H) SCRATCH.height = H;
  return SCRATCH;
}

// Redraw the current canvas through a CSS filter (for grayscale/sepia).
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

// One 256x256 tile of gray noise, built once.
let NOISE = null;
function noiseTile() {
  if (NOISE) return NOISE;
  if (typeof document === "undefined" && typeof OffscreenCanvas === "undefined") return null;
  const N = 256;
  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(N, N) : document.createElement("canvas");
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
  ctx.translate(ox, oy);
  ctx.fillStyle = p;
  ctx.fillRect(-ox, -oy, W, H);
  ctx.restore();
}

// Deterministic pseudo-random in [0,1) from an integer seed.
function rnd(seed) { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); }

function drawParticles(ctx, W, H, intensity, t, opts) {
  const n = Math.round(opts.base * (0.3 + intensity));
  ctx.save();
  ctx.fillStyle = opts.color;
  for (let i = 0; i < n; i++) {
    const sx = rnd(i + 1), sy = rnd(i + 7), sr = rnd(i + 13), ss = rnd(i + 19);
    const speed = opts.minSpeed + ss * opts.spanSpeed;
    const drift = Math.sin(t * opts.drift + i) * opts.driftAmp * W;
    const x = ((sx * W + drift) % W + W) % W;
    const y = (((sy + t * speed) % 1) + 1) % 1 * H;
    const r = opts.minR + sr * opts.spanR;
    ctx.globalAlpha = opts.minA + sr * opts.spanA;
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
  snow:     { id: "snow", label: "Snow", group: "particle", apply: (c, W, H, i, t) => drawParticles(c, W, H, i, t, { base: 140, color: "#ffffff", minSpeed: 0.03, spanSpeed: 0.05, drift: 0.6, driftAmp: 0.03, minR: 1, spanR: 2.2, minA: 0.35, spanA: 0.5 }) },
  dust:     { id: "dust", label: "Dust", group: "particle", apply: (c, W, H, i, t) => drawParticles(c, W, H, i, t, { base: 90, color: "#d9d2c0", minSpeed: 0.008, spanSpeed: 0.02, drift: 0.4, driftAmp: 0.05, minR: 0.6, spanR: 1.6, minA: 0.15, spanA: 0.35 }) },
};

export const EFFECT_LIST = Object.keys(EFFECTS).map((id) => EFFECTS[id]);

export function applyEffect(ctx, id, intensity, W, H, t) {
  const fx = EFFECTS[id];
  if (!fx || id === "none") return;
  fx.apply(ctx, W, H, Math.max(0, Math.min(1, intensity == null ? 0.5 : intensity)), t || 0);
}
```

- [ ] Verify: `npx vitest run` → 41 passed; dev server 200 + `✓ Compiled` (module unused so far).
- [ ] Commit: `git add lib/effects.js && git commit -m "Add lib/effects.js (atmosphere effects)"`

---

### Task 2: `EffectTile` component

**File:** Create `components/panels/EffectTile.js`

- [ ] Mirror `TransitionTile`: sample scene + `applyEffect`, hover-animated.

```js
import { useEffect, useRef } from "react";
import { applyEffect } from "../../lib/effects";

// Built-in sample scene so grades/grain/vignette/particles all read.
function drawScene(ctx, W, H) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#6b7482"); sky.addColorStop(1, "#c7ccd2");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#eef0f2"; ctx.beginPath(); ctx.arc(W * 0.68, H * 0.34, H * 0.13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3a4048"; ctx.beginPath();
  ctx.moveTo(0, H); ctx.lineTo(W * 0.32, H * 0.55); ctx.lineTo(W * 0.55, H * 0.78);
  ctx.lineTo(W * 0.78, H * 0.5); ctx.lineTo(W, H * 0.72); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
}

const REST_T = 0.5;
const LOOP_MS = 1600;

export default function EffectTile({ fx, on, onClick }) {
  const ref = useRef(null);
  const rafRef = useRef(0);

  const paintAt = (t) => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    drawScene(ctx, W, H);
    applyEffect(ctx, fx.id, 0.85, W, H, t);
  };

  useEffect(() => { paintAt(REST_T); return () => cancelAnimationFrame(rafRef.current); }, [fx.id]);

  const start = () => {
    cancelAnimationFrame(rafRef.current);
    const t0 = performance.now();
    const step = (t) => { paintAt(Math.max(0, t - t0) / 1000); rafRef.current = requestAnimationFrame(step); };
    rafRef.current = requestAnimationFrame(step);
  };
  const stop = () => { cancelAnimationFrame(rafRef.current); paintAt(REST_T); };

  return (
    <button type="button" className={`trtile ${on ? "is-on" : ""}`} onClick={onClick}
      onPointerEnter={start} onPointerLeave={stop} title={fx.label}>
      <canvas ref={ref} width={140} height={140} className="trtile__cv" />
      <span className="trtile__label">{fx.label}</span>
    </button>
  );
}
```

- [ ] Verify: dev server 200 + `✓ Compiled` (unused until Task 3).
- [ ] Commit: `git add components/panels/EffectTile.js && git commit -m "Add EffectTile (sample-scene preview)"`

---

### Task 3: `EffectsPanel` — grid + intensity (replace stub)

**File:** `components/panels/EffectsPanel.js`

- [ ] Replace the stub with the grid + intensity slider:

```js
import { EFFECT_LIST } from "../../lib/effects";
import EffectTile from "./EffectTile";

export default function EffectsPanel({ effectId, setEffectId, effectIntensity, setEffectIntensity }) {
  const active = effectId && effectId !== "none";
  return (
    <div className="panel">
      <h2 className="panel__h">Atmosphere &amp; Genre FX</h2>
      <div className="mini-h">One effect applies to the whole video.</div>
      <div className="trgrid">
        {EFFECT_LIST.map((fx) => (
          <EffectTile key={fx.id} fx={fx} on={effectId === fx.id} onClick={() => setEffectId(fx.id)} />
        ))}
      </div>
      <label className="trdur" style={{ marginTop: 12, opacity: active ? 1 : 0.5 }}>
        <span>Intensity</span>
        <input type="range" min={0} max={1} step={0.05} value={effectIntensity}
          disabled={!active} onChange={(e) => setEffectIntensity(+e.target.value)} />
        <span className="trdur__val">{Math.round(effectIntensity * 100)}%</span>
      </label>
    </div>
  );
}
```

- [ ] Verify: dev server 200 + `✓ Compiled` (props wired in Task 5).
- [ ] Commit: `git add components/panels/EffectsPanel.js && git commit -m "EffectsPanel: effect grid + intensity"`

---

### Task 4: `app/page.js` — state, persistence, render specs

**File:** `app/page.js`

- [ ] Add state near the other global settings (by `fadeOut`, ~line 128):

```js
const [effectId, setEffectId] = useState("none");
const [effectIntensity, setEffectIntensity] = useState(0.5);
```

- [ ] Reset (with `setFadeIn`/`setFadeOut` resets): add
  `setEffectId("none"); setEffectIntensity(0.5);`
- [ ] Persisted composition doc: add `effectId, effectIntensity,` next to
  `fadeIn, fadeOut,` in the `useMemo` object; add both to that memo's dep array.
- [ ] Also add both to the OTHER dep array that lists `fadeIn, fadeOut` (the
  autosave `useEffect`, ~line 540 area).
- [ ] Restore (`applyDoc`, where `setFadeIn(d.fadeIn ...)`): add
  `setEffectId(d.effectId ?? "none"); setEffectIntensity(d.effectIntensity ?? 0.5);`
- [ ] Both render specs (WebCodecs test + fallback, where `fadeIn, fadeOut` are
  passed): add `effectId, effectIntensity,`; add both to each spec callback's dep
  array.
- [ ] Pass to `<Editor>` (near the caption props):
  `effectId={effectId} setEffectId={setEffectId} effectIntensity={effectIntensity} setEffectIntensity={setEffectIntensity}`
- [ ] Verify: `npx vitest run` → 41 passed; dev server 200 + `✓ Compiled`.
- [ ] Commit: `git add app/page.js && git commit -m "page.js: effectId/effectIntensity state, persistence, render specs"`

---

### Task 5: `Editor.js` — thread to panel + preview draw

**File:** `components/Editor.js`

- [ ] Add `import { applyEffect } from "../lib/effects";`.
- [ ] Add `effectId, setEffectId, effectIntensity, setEffectIntensity` to the
  `Editor({...})` prop destructure.
- [ ] In `draw()`, immediately before the captions block
  (`// Captions burn in ...`), add:

```js
applyEffect(ctx, effectId, effectIntensity, W, H, t);
```

Add `effectId, effectIntensity` to the `draw` `useCallback` dep array.

- [ ] Pass to `<EffectsPanel>` in the tabs array (the `effects` tab node):

```jsx
{ id: "effects", label: "Effects", node: (
  <EffectsPanel
    effectId={effectId} setEffectId={setEffectId}
    effectIntensity={effectIntensity} setEffectIntensity={setEffectIntensity}
  />
) },
```

- [ ] Verify: `npx vitest run` → 41 passed; dev server 200 + `✓ Compiled`.
- [ ] Commit: `git add components/Editor.js && git commit -m "Editor: thread effect settings to panel + preview"`

---

### Task 6: WebCodecs export — apply the effect

**File:** `lib/webcodecsRender.js`

- [ ] Add `import { applyEffect } from "./effects";` (top, with the other lib imports).
- [ ] Destructure from `spec` (near `captionStyle …`): add
  `effectId = "none", effectIntensity = 0.5,`.
- [ ] In the frame loop, after the image/transition draw and BEFORE
  `if (hasCaptions)`, add:

```js
applyEffect(ctx, effectId, effectIntensity, W, H, t);
```

- [ ] Verify: `npx vitest run` → 41 passed; dev server 200 + `✓ Compiled`.
- [ ] Commit: `git add lib/webcodecsRender.js && git commit -m "WebCodecs export: apply atmosphere effect"`

---

### Task 7: Final verification

- [ ] `npx vitest run` → 41 passed.
- [ ] Dev server: open Effects tab → grid of tiles (None + 9), hover animates
  grain/snow; selecting one + intensity changes the preview; None = unchanged.
- [ ] Stop the dev server, then `npm run build` → compiles clean; restart dev.

## Self-review notes

- **Spec coverage:** effects lib (T1), tiles (T2), panel (T3), state/persistence/
  render-specs (T4), preview draw + panel wiring (T5), export (T6). Covered.
- **Signature consistency:** `applyEffect(ctx, id, intensity, W, H, t)` defined T1,
  called identically in T2 tile, T5 Editor, T6 webcodecs. `EFFECT_LIST`/`EFFECTS`
  from T1 used in T2/T3.
- **Dev-safe verification:** no `next build` while dev runs (prior `.next`
  corruption); vitest + dev-server compile output during tasks, full build only in
  T7 with dev stopped.
