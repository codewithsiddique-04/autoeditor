# Captions Variety — Design (Spec #3)

**Date:** 2026-09-12
**Branch:** `redesign/capcut-layout`
**Status:** Approved for planning

## Context

Spec #3 of the CapCut redesign. Expands caption variety: more **style presets**,
a **font picker** (bundled OFL fonts), and a **position** control — with caption
styles shown as **visual "Aa" preview tiles** (matching the transition grid built
in the shell work).

### Architectural facts

- The WebCodecs export draws captions with the SAME `drawCaption()` canvas
  function as the live preview (`lib/webcodecsRender.js` imports it). So any
  style/font/position that works in `drawCaption` works in **both** preview and
  export — WYSIWYG. The `dt()` / `buildCaptionBurn()` ffmpeg `drawtext` path is
  used only by the disabled `serverRender.js`.
- Today: 3 presets (`classic`, `boxed`, `yellow`) in `lib/captions.js`, one
  bundled font (`public/fonts/caption.ttf`), and `drawCaption` hardcodes that
  single font family and bottom anchoring.
- Caption **output** colors (white/yellow/mint) are about the exported video, not
  the app's silver-on-black UI chrome — so colored presets are fine. The
  silver/gray rule applies to UI (tiles' neutral backdrop), not caption fills.

## Decisions (from brainstorming)

1. Scope: **presets + fonts + position**. No entrance animation, no word-level
   karaoke (need per-cue progress / word timestamps — a later spec).
2. Caption styles rendered as **visual "Aa" tiles** (grid), like transitions.
3. Fonts fetched as **OFL `.ttf`** from Google Fonts, committed to
   `public/fonts/` (done: `montserrat.ttf`, `anton.ttf`, `poppins.ttf`).

## Design

### 1. Data model (`lib/captions.js`)

Extend the style object shape with optional fields, keeping `fill`/`stroke`/`box`
and the required `dt()` (so the disabled ffmpeg path never throws):
- `shadow`: `{ color, blur }` (blur is a fraction of fontPx) — soft drop shadow.
- `bar`: `true` → a single full-width translucent bar behind the whole caption
  block (vs `box` which is a snug per-line box).
- `strokeW`: optional multiplier on outline thickness (default 1).

Preset list (8), each with a `label` and a `dt()`:
| id | look |
|----|------|
| `classic` | white + black outline *(keep)* |
| `boxed` | white on snug black box *(keep)* |
| `yellow` | yellow + black outline *(keep)* |
| `bar` | white on a full-width translucent black bar |
| `shadow` | white, soft drop shadow, no outline |
| `bold` | white + heavy black outline (`strokeW` ~1.7) |
| `mint` | sage `#a0c2b4` fill + dark outline |
| `cinema` | warm off-white `#efe7d0` + soft shadow |

New exports:
- `CAPTION_FONTS = [{id,label,family}]`: `default`→`CaptionFont`,
  `montserrat`→`Montserrat`, `anton`→`Anton`, `poppins`→`Poppins`.
- `CAPTION_POSITIONS = ["top","middle","bottom"]` (default `bottom`).

### 2. Rendering (`lib/captions.js`)

- `lineTop()` gains a `position` arg: `bottom` = current formula; `top` = anchored
  near the top margin; `middle` = block vertically centered.
- `drawCaption(ctx, text, W, H, styleId, fontPx, lineHeight, fontFamily, position)`:
  - font string uses `fontFamily` (fallback `system-ui, sans-serif`).
  - renders `bar` (full-width rect), `shadow` (canvas `shadowColor`/`shadowBlur`),
    and `strokeW` in addition to the existing `box`/`stroke`/`fill`.
- `buildCaptionBurn(...)` gains matching `fontFamily`/`position` args and passes
  `position` to `lineTop()` (best-effort; disabled path — must not break).

### 3. State plumbing (`app/page.js`)

Two new settings, threaded exactly like the existing caption settings:
`captionFont` (default `"default"`) and `captionPosition` (default `"bottom"`).
Added to: state + setters, the reset, the persisted `captions:{…}` object, the
restore, and **both** render specs (WebCodecs test + fallback). Passed to
`<Editor>`.

### 4. WebCodecs render (`lib/webcodecsRender.js`)

- Destructure `captionFont`, `captionPosition` from `spec` (defaults).
- Resolve the family from `CAPTION_FONTS`; `document.fonts.load` that family
  (as it already does for `CaptionFont`).
- Pass `fontFamily` + `captionPosition` into the `drawCaption(...)` call.

### 5. Preview (`components/Editor.js`)

- Accept `captionFont`, `captionPosition` props; pass to `CaptionsPanel`.
- `Editor.draw()` passes the resolved family + position into `drawCaption(...)`.

### 6. UI (`components/panels/CaptionsPanel.js` + new `CaptionStyleTile.js`)

- **`CaptionStyleTile`**: a square tile rendering a sample (`"Aa"`) via the real
  `drawCaption()` for that style, on a neutral mid-gray backdrop (so white/box/bar
  all read). Static (styles don't animate). Selected state mirrors the transition
  tile (`--accent` ring). Reuses `.trgrid`/`.trtile` classes (rename-neutral) or a
  `.captiles` variant.
- **CaptionsPanel** (in the populated branch): Style = grid of `CaptionStyleTile`;
  **Font** = chips whose label is set in that font-family (self-previewing);
  **Position** = segmented control (Top/Middle/Bottom). Size / font-scale /
  line-spacing controls stay as they are.

### 7. Fonts (`app/globals.css`)

`@font-face` for `Montserrat`, `Anton`, `Poppins` (weight 700; Montserrat is a
variable font, so a 100–900 range is fine) pointing at the bundled `.ttf`s.

## Out of scope

Entrance animation, word-by-word karaoke, full ffmpeg-path parity for the new
fields (disabled render — kept from breaking only).

## Success criteria

- Captions tab shows a grid of "Aa" style tiles (8 presets), a font picker
  (4 fonts), and Top/Middle/Bottom position — all in the silver-on-black UI.
- Selecting any style/font/position updates the **preview** and the **exported
  MP4** identically (WYSIWYG via shared `drawCaption`).
- Settings persist per project (save/restore) and reset with a new project.
- No regression to existing caption upload/parse, size, font-scale, line-spacing.
- `vitest` stays green; dev server compiles clean.
