# Effects Tab (Atmosphere & Genre FX) — Design (Spec #4)

**Date:** 2026-09-12
**Branch:** `redesign/capcut-layout`
**Status:** Approved for planning

## Context

Spec #4 of the CapCut redesign. Fills the currently-stubbed **Effects** tab with a
set of **global atmosphere effects** (color grades, film grain, vignette, and
animated particles) that render in both the preview and the WebCodecs export.

### Architectural facts

- A visual effect is a **per-frame canvas post-process** applied AFTER the image +
  transition are drawn and BEFORE captions/fades — one spot in `Editor.draw()`
  (~line 221, just before the captions block) and the mirror spot in
  `lib/webcodecsRender.js` (~line 733, just before `if (hasCaptions)`). So a single
  `lib/effects.js` plugs into both → preview and export match (WYSIWYG). No render
  pipeline change.
- **Performance is the constraint:** the export runs this on every frame
  (thousands). Effects must avoid full-frame per-pixel JS loops. Allowed cheap
  primitives: `ctx.filter` (with a reusable offscreen self-copy), blended overlays,
  pre-baked noise tiles, and a small deterministic particle sim.

## Decisions (from brainstorming)

1. **Effect model: global, one effect + intensity.** `effectId` (default `"none"`)
   and `effectIntensity` (0–1, default `0.5`), stored like `fadeIn`/`motionAmount`.
   No per-clip effects (out of scope).
2. **v1 effect set (~10, incl. None):** `bw`, `warm`, `cool`, `sepia`
   (color grades); `grain`, `noise` (film grain / heavy noise); `vignette`;
   `snow`, `dust` (particles).
3. **Effect tiles with hover animation** (like the transition/caption grids).

## Design

### 1. `lib/effects.js` (new)

- `EFFECTS`: id → `{ id, label, group, apply(ctx, W, H, intensity, t) }`.
- `EFFECT_LIST = Object.values(EFFECTS)` for the UI.
- `applyEffect(ctx, id, intensity, W, H, t)`: no-op for `none`/unknown; else
  `EFFECTS[id].apply(...)`. `t` = seconds (drives grain flicker + particle motion).
- Implementations (all cheap, no per-pixel JS loops):
  - **`bw`, `sepia`** — self-copy + `ctx.filter`: draw the current canvas into a
    reusable module-level offscreen (`getScratch(W,H)`), clear, set
    `ctx.filter` (`grayscale(intensity)` / `sepia(intensity)`), redraw the copy,
    reset filter. 2 `drawImage`s + 1 clear per frame.
  - **`warm`, `cool`** — fill a translucent tint (`warm`=orange, `cool`=blue) over
    the frame with `globalCompositeOperation = "soft-light"`, alpha ∝ intensity.
  - **`vignette`** — one radial gradient (transparent center → black edge),
    `source-over`, alpha ∝ intensity.
  - **`grain`, `noise`** — draw a pre-baked 256×256 noise-tile canvas (built once,
    lazily) tiled over the frame with `globalCompositeOperation = "overlay"`
    (grain) / `"soft-light"` or higher alpha (noise); tile origin offset chosen
    from `t` so it flickers. alpha ∝ intensity.
  - **`snow`, `dust`** — N particles (N ∝ intensity) whose positions are computed
    **deterministically from `t`** (seeded per index; e.g. `x = seedX*W + drift`,
    `y = ((seedY + t*speed) % 1)*H`), drawn as soft white/gray dots. No stored
    state → preview and export are identical.
- Always `ctx.save()/restore()` around each effect so blend mode / filter / alpha
  never leak to captions or the next frame.

### 2. Render integration

- **`Editor.draw()`**: after the image/transition draw, before the captions block,
  call `applyEffect(ctx, effectId, effectIntensity, W, H, t)`. Add `effectId`,
  `effectIntensity` to the `draw` dependency array.
- **`lib/webcodecsRender.js`**: destructure `effectId = "none"`,
  `effectIntensity = 0.5` from `spec`; call `applyEffect(ctx, effectId,
  effectIntensity, W, H, t)` after the frame draw, before `if (hasCaptions)`.

### 3. UI — `EffectsPanel` + `EffectTile`

- **`EffectTile`** (new, mirrors `TransitionTile`): a square canvas that renders a
  built-in sample scene (sky→ground gradient + a light disc "sun") then
  `applyEffect(...)` over it. Static at rest (mid `t`); **animated on hover**
  (grain flicker / falling snow) via rAF, clamped like the transition tile.
- **`EffectsPanel`** (replaces the "Coming soon" stub): a `.trgrid` of `EffectTile`
  (None first, then the set) + an **Intensity** slider (`.trdur`), disabled/greyed
  when `effectId === "none"`.

### 4. State plumbing (`app/page.js`)

`effectId` (`"none"`) and `effectIntensity` (`0.5`), threaded like `fadeIn`:
state + setters, reset, the persisted composition doc (top-level fields) + its
dep arrays, restore, both render specs (WebCodecs test + fallback) + their dep
arrays, and passed to `<Editor>`.

### 5. `Editor.js`

Accept `effectId`, `effectIntensity` (+ setters) props; pass to `EffectsPanel`
(via the tabs array) and into the `draw()` `applyEffect(...)` call.

### 6. CSS (`app/globals.css`)

Reuse `.trgrid`/`.trtile*` for the effect grid (add thin `.fxtile` aliases only if
labels/needs differ; otherwise reuse verbatim). No new layout.

## Out of scope

Per-clip effects, WebGL/shader effects (ripple/warp/true motion blur), any
full-frame per-pixel JS effect, and ffmpeg-path parity (disabled render — the
`applyEffect` post-process is canvas-only; the ffmpeg path simply won't show
effects, and must not break).

## Success criteria

- Effects tab shows a grid of effect tiles (None + ~9) with hover-animated
  previews and an intensity slider, in the silver-on-black UI.
- Selecting an effect changes the **preview** and the **exported MP4** identically.
- `none` = no visual change and no measurable per-frame cost.
- Setting persists per project (save/restore) and resets with a new project.
- Export stays performant (no full-frame per-pixel loops); no regression to
  transitions, captions, motion, fades.
- `vitest` stays green; dev server + production build compile clean.
