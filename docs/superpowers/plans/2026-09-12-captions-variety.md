# Captions Variety Implementation Plan (Spec #3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) tracking.

**Goal:** Add more caption style presets (as visual "Aa" tiles), a font picker (3 bundled OFL fonts), and a Top/Middle/Bottom position control — rendered by the shared `drawCaption()` so preview and export match.

**Architecture:** Extend `lib/captions.js` (styles, fonts, positions, `drawCaption`/`lineTop` signatures), thread two new settings (`captionFont`, `captionPosition`) through `page.js` → `Editor` → `CaptionsPanel` and into both render paths, and add a `CaptionStyleTile` grid.

**Verification:** `npx vitest run` (must stay 41 passed) + the **live dev server** (curl `http://localhost:3000/` for 200 and read its task output for `✓ Compiled` / errors). **Do NOT run `next build` while the dev server is running** — it corrupts the shared `.next/` cache.

Fonts already downloaded: `public/fonts/{montserrat,anton,poppins}.ttf`.

---

### Task 1: Fonts + caption-tile CSS (`app/globals.css`)

- [ ] Add `@font-face` for `Montserrat`, `Anton`, `Poppins` (weight 700) after the existing `CaptionFont` face:

```css
@font-face { font-family: "Montserrat"; src: url("/fonts/montserrat.ttf") format("truetype"); font-weight: 100 900; font-display: swap; }
@font-face { font-family: "Anton"; src: url("/fonts/anton.ttf") format("truetype"); font-weight: 400; font-display: swap; }
@font-face { font-family: "Poppins"; src: url("/fonts/poppins.ttf") format("truetype"); font-weight: 700; font-display: swap; }
```

- [ ] Add caption-tile styles (reuse the transition grid look) near `.trgrid`:

```css
.captiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(82px, 1fr)); gap: 8px; }
.captile { display: flex; flex-direction: column; gap: 4px; padding: 0; background: none; border: none; cursor: pointer; font: inherit; min-width: 0; }
.captile__cv { width: 100%; aspect-ratio: 1 / 1; display: block; border-radius: 8px; border: 1.5px solid var(--line); transition: border-color .12s, box-shadow .12s; }
.captile:hover .captile__cv { border-color: var(--muted); }
.captile.is-on .captile__cv { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.captile__label { font-size: 11px; color: var(--muted); text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.captile.is-on .captile__label { color: var(--accent); }
/* Font chips preview their own family via inline font-family on each chip. */
```

- [ ] Verify: `npx vitest run` → 41 passed; curl `http://localhost:3000/` → 200; dev output shows `✓ Compiled`.
- [ ] Commit: `git add app/globals.css public/fonts && git commit -m "Bundle OFL caption fonts + caption-tile CSS"`

---

### Task 2: Extend `lib/captions.js` — styles, fonts, positions

- [ ] Replace `CAPTION_STYLES` with the 8-preset set; each keeps `id,label,fill,stroke,box` and adds optional `shadow`/`bar`/`strokeW`, and each has a `dt()`:

```js
export const CAPTION_STYLES = {
  classic: { id:"classic", label:"Classic", fill:"#ffffff", stroke:"#000000", box:null,
    dt:(bw)=>`fontcolor=white:borderw=${bw}:bordercolor=black@0.9` },
  boxed: { id:"boxed", label:"Boxed", fill:"#ffffff", stroke:null, box:"rgba(0,0,0,0.6)",
    dt:(bw,fs)=>`fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=${Math.max(3,Math.round(fs*0.16))}` },
  yellow: { id:"yellow", label:"Yellow", fill:"#ffd400", stroke:"#000000", box:null,
    dt:(bw)=>`fontcolor=0xFFD400:borderw=${bw}:bordercolor=black@0.9` },
  bar: { id:"bar", label:"Bar", fill:"#ffffff", stroke:null, box:null, bar:"rgba(0,0,0,0.55)",
    dt:(bw,fs)=>`fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=${Math.max(3,Math.round(fs*0.16))}` },
  shadow: { id:"shadow", label:"Shadow", fill:"#ffffff", stroke:null, box:null, shadow:{color:"rgba(0,0,0,0.85)",blur:0.18},
    dt:(bw)=>`fontcolor=white:shadowcolor=black@0.85:shadowx=2:shadowy=2` },
  bold: { id:"bold", label:"Bold", fill:"#ffffff", stroke:"#000000", box:null, strokeW:1.7,
    dt:(bw)=>`fontcolor=white:borderw=${Math.round(bw*1.7)}:bordercolor=black` },
  mint: { id:"mint", label:"Mint", fill:"#a0c2b4", stroke:"#0e1512", box:null,
    dt:(bw)=>`fontcolor=0xA0C2B4:borderw=${bw}:bordercolor=black@0.9` },
  cinema: { id:"cinema", label:"Cinema", fill:"#efe7d0", stroke:null, box:null, shadow:{color:"rgba(0,0,0,0.7)",blur:0.14},
    dt:(bw)=>`fontcolor=0xEFE7D0:shadowcolor=black@0.7:shadowx=2:shadowy=2` },
};
```

- [ ] Add fonts + positions exports (after `CAPTION_STYLE_LIST`):

```js
export const CAPTION_FONTS = [
  { id:"default", label:"Default", family:"CaptionFont" },
  { id:"montserrat", label:"Montserrat", family:"Montserrat" },
  { id:"anton", label:"Anton", family:"Anton" },
  { id:"poppins", label:"Poppins", family:"Poppins" },
];
export const CAPTION_POSITIONS = ["top", "middle", "bottom"];
export function captionFontFamily(id) {
  const f = CAPTION_FONTS.find((x) => x.id === id);
  return f ? f.family : "CaptionFont";
}
```

- [ ] Update `lineTop` to take `position` and total block height, defaulting to bottom:

```js
const lineTop = (H, fontPx, n, i, lhf = 1.16, position = "bottom") => {
  const blockH = n * fontPx * lhf;
  let top0; // top y of the first line's slot
  if (position === "top") top0 = H * MARGIN_FACTOR;
  else if (position === "middle") top0 = (H - blockH) / 2;
  else top0 = H - H * MARGIN_FACTOR - blockH; // bottom
  return Math.round(top0 + i * fontPx * lhf);
};
```

- [ ] Update `drawCaption` signature and rendering (font family, position, shadow, bar, strokeW):

```js
export function drawCaption(ctx, text, W, H, styleId, fontPx, lineHeight, fontFamily = "CaptionFont", position = "bottom") {
  if (!text) return;
  const st = CAPTION_STYLES[styleId] || CAPTION_STYLES.classic;
  const lines = wrapToWidth(text, captionMaxChars(W, fontPx));
  const n = lines.length;
  const lhf = lineHeight > 0 ? lineHeight : lineHeightFactor(st);

  ctx.save();
  ctx.font = `700 ${fontPx}px "${fontFamily}", "CaptionFont", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Full-width bar behind the whole block.
  if (st.bar) {
    const top = lineTop(H, fontPx, n, 0, lhf, position) - fontPx * 0.9;
    const barH = n * fontPx * lhf + fontPx * 0.5;
    ctx.fillStyle = st.bar;
    ctx.fillRect(0, top, W, barH);
  }

  for (let i = 0; i < n; i++) {
    const ln = lines[i];
    const top = lineTop(H, fontPx, n, i, lhf, position);
    const base = top + fontPx * 0.82;
    if (st.box) {
      const w = ctx.measureText(ln).width;
      const padX = fontPx * 0.38, padY = fontPx * 0.12;
      const boxTop = base - fontPx * 0.78 - padY;
      const boxH = fontPx * 0.98 + padY * 2;
      ctx.fillStyle = st.box;
      ctx.fillRect((W - w) / 2 - padX, boxTop, w + padX * 2, boxH);
    }
    if (st.shadow) { ctx.shadowColor = st.shadow.color; ctx.shadowBlur = fontPx * st.shadow.blur; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = fontPx * 0.04; }
    if (st.stroke) {
      ctx.lineJoin = "round"; ctx.miterLimit = 2;
      ctx.lineWidth = Math.max(2, fontPx / 7) * (st.strokeW || 1);
      ctx.strokeStyle = st.stroke;
      ctx.strokeText(ln, W / 2, base);
    }
    ctx.fillStyle = st.fill;
    ctx.fillText(ln, W / 2, base);
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; // reset for next line
  }
  ctx.restore();
}
```

- [ ] Update `buildCaptionBurn(cues, styleId, width, height, sizeId, lineHeight, fontScale, position = "bottom")`: pass `position` into its `lineTop(...)` call. (Font family for ffmpeg stays `CAPTION_FONT`; disabled path.)
- [ ] Verify: `npx vitest run` → 41 passed; dev server 200 + `✓ Compiled`.
- [ ] Commit: `git add lib/captions.js && git commit -m "Add caption presets, fonts, position to drawCaption/lineTop"`

---

### Task 3: `CaptionStyleTile` component

**File:** Create `components/panels/CaptionStyleTile.js`

- [ ] Static tile rendering `"Aa"` via the real `drawCaption` on a neutral backdrop:

```js
import { useEffect, useRef } from "react";
import { drawCaption } from "../../lib/captions";

export default function CaptionStyleTile({ st, fontFamily, on, onClick }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#4a4a52"); g.addColorStop(1, "#2a2a30"); // neutral gray so white/box/bar read
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    drawCaption(ctx, "Aa", W, H, st.id, Math.round(H * 0.34), 1.16, fontFamily || "CaptionFont", "middle");
  }, [st.id, fontFamily]);
  return (
    <button type="button" className={`captile ${on ? "is-on" : ""}`} onClick={onClick} title={st.label}>
      <canvas ref={ref} width={140} height={140} className="captile__cv" />
      <span className="captile__label">{st.label}</span>
    </button>
  );
}
```

- [ ] Verify: dev server 200 + `✓ Compiled` (component unused until Task 4).
- [ ] Commit: `git add components/panels/CaptionStyleTile.js && git commit -m "Add CaptionStyleTile (Aa preview)"`

---

### Task 4: `CaptionsPanel` — style tiles + font chips + position

**File:** `components/panels/CaptionsPanel.js`

- [ ] Update imports and props:

```js
import CaptionStyleTile from "./CaptionStyleTile";
import { CAPTION_STYLE_LIST, CAPTION_SIZES, captionLineHeightDefault, CAPTION_FONTS, captionFontFamily } from "../../lib/captions";
```
Add props: `captionFont, setCaptionFont, captionPosition, setCaptionPosition`.

- [ ] Replace the Style `.transitions__chips` block with a tile grid:

```jsx
<div className="mini-h">Style</div>
<div className="captiles">
  {CAPTION_STYLE_LIST.map((st) => (
    <CaptionStyleTile
      key={st.id} st={st} fontFamily={captionFontFamily(captionFont)}
      on={captionStyle === st.id} onClick={() => setCaptionStyle(st.id)}
    />
  ))}
</div>

<div className="mini-h" style={{ marginTop: 12 }}>Font</div>
<div className="transitions__chips">
  {CAPTION_FONTS.map((f) => (
    <button key={f.id} type="button"
      className={`trchip ${captionFont === f.id ? "is-on" : ""}`}
      style={{ fontFamily: `"${f.family}", system-ui, sans-serif` }}
      onClick={() => setCaptionFont(f.id)}
    >{f.label}</button>
  ))}
</div>

<div className="mini-h" style={{ marginTop: 12 }}>Position</div>
<div className="seg">
  {[["top","Top"],["middle","Middle"],["bottom","Bottom"]].map(([id,lbl]) => (
    <button key={id} type="button"
      className={captionPosition === id ? "is-on" : ""}
      onClick={() => setCaptionPosition(id)}
    >{lbl}</button>
  ))}
</div>
```

- [ ] Verify: dev server 200 + `✓ Compiled` (props still undefined from Editor until Task 6, but component compiles).
- [ ] Commit: `git add components/panels/CaptionsPanel.js && git commit -m "CaptionsPanel: Aa style tiles, font picker, position control"`

---

### Task 5: `Editor.js` — pass font/position to CaptionsPanel and drawCaption

**File:** `components/Editor.js`

- [ ] Add `captionFont, captionPosition` to the `Editor({...})` prop destructure (near the other caption props).
- [ ] Import the resolver: `import { captionAt, drawCaption, captionFontPx } from "../lib/captions";` → also import `captionFontFamily` from the same module.
- [ ] In `draw()`, update the `drawCaption(...)` call:

```js
drawCaption(ctx, txt, W, H, captionStyle, captionFontPx(H, captionSize, captionFontScale), captionLineHeight, captionFontFamily(captionFont), captionPosition);
```
Add `captionFont`, `captionPosition` to the `draw` `useCallback` dependency array.

- [ ] Pass the two props into `<CaptionsPanel …>` in the tabs array:

```jsx
captionFont={captionFont} setCaptionFont={setCaptionFont}
captionPosition={captionPosition} setCaptionPosition={setCaptionPosition}
```

- [ ] Verify: `npx vitest run` → 41 passed; dev server 200 + `✓ Compiled`.
- [ ] Commit: `git add components/Editor.js && git commit -m "Editor: thread captionFont/captionPosition to panel + preview"`

---

### Task 6: `page.js` — state, persistence, render specs, pass to Editor

**File:** `app/page.js`

- [ ] Add state (near the other caption state, ~line 141):

```js
const [captionFont, setCaptionFont] = useState("default");
const [captionPosition, setCaptionPosition] = useState("bottom");
```

- [ ] Reset (with the other caption resets, ~line 463): add
  `setCaptionFont("default"); setCaptionPosition("bottom");`
- [ ] Persist: add `captionFont, captionPosition` to the `captions:{…}` object at
  each of the three sites (~lines 496, 508, 537).
- [ ] Restore (~line 589): add
  `setCaptionFont(cp.captionFont ?? "default"); setCaptionPosition(cp.captionPosition ?? "bottom");`
- [ ] Both render specs (~lines 675 and 776): add `captionFont, captionPosition,`
  next to `captionStyle, captionSize, …`. Add both to the two surrounding
  `useCallback` dependency arrays (~lines 686, 843).
- [ ] Pass to `<Editor>` (with the other caption props, ~line 1085):
  `captionFont={captionFont} setCaptionFont={setCaptionFont} captionPosition={captionPosition} setCaptionPosition={setCaptionPosition}`
- [ ] Verify: `npx vitest run` → 41 passed; dev server 200 + `✓ Compiled`.
- [ ] Commit: `git add app/page.js && git commit -m "page.js: captionFont/captionPosition state, persistence, render specs"`

---

### Task 7: WebCodecs export — apply font + position

**File:** `lib/webcodecsRender.js`

- [ ] Import the resolver: add `captionFontFamily` to the `./captions` import (with `captionAt, drawCaption, captionFontPx`).
- [ ] Destructure from `spec` (near `captionStyle, captionSize, …`): add
  `captionFont = "default", captionPosition = "bottom",`.
- [ ] Where captions load the font (`document.fonts.load('700 …px "CaptionFont"')`), also load the selected family:

```js
const capFamily = captionFontFamily(captionFont);
if (hasCaptions && typeof document !== "undefined" && document.fonts) {
  try { await document.fonts.load(`700 ${capFontPx}px "${capFamily}"`); } catch (_) {}
}
```

- [ ] Update the render-loop `drawCaption(...)` call:

```js
if (cap) drawCaption(ctx, cap, W, H, captionStyle, capFontPx, captionLineHeight, capFamily, captionPosition);
```

- [ ] Verify: `npx vitest run` → 41 passed; dev server 200 + `✓ Compiled`.
- [ ] Commit: `git add lib/webcodecsRender.js && git commit -m "WebCodecs export: apply caption font + position"`

---

### Task 8: Final verification

- [ ] `npx vitest run` → 41 passed.
- [ ] Dev server (`http://localhost:3000`) compiles clean; open Captions tab: 8 "Aa" style tiles, 4 font chips (each shown in its font), Top/Middle/Bottom position. Selecting each updates the preview.
- [ ] (Optional, only with dev server stopped) `npm run build` for a full production compile check.

## Self-review notes

- **Spec coverage:** data model (T2), rendering (T2), state plumbing (T6),
  webcodecs (T7), preview (T5), UI + tiles (T3,T4), fonts CSS (T1). Covered.
- **Signature consistency:** `drawCaption(…, fontFamily, position)` and
  `lineTop(…, position)` defined in T2 and called with those args in T4 tile, T5
  Editor, T7 webcodecs. `captionFontFamily(id)` defined T2, used T4/T5/T7.
- **Dev-safe verification:** no `next build` while dev runs (caused the earlier
  `.next` corruption); use vitest + dev-server compile output instead.
