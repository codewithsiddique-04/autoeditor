# CapCut-style Layout Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the editor into a CapCut-style shell — a tabbed left panel (Motion / Transitions / Captions / Effects), center preview, right Export, and a full-width bottom timeline — by relocating existing panels and splitting `Editor.js` into focused components, with no functional change.

**Architecture:** Pure UI restructure. `app/page.js` is untouched; it keeps passing the same props to `<Editor>`. Each existing side panel is extracted into its own component and first re-rendered in the *current* layout (so every commit ships a working app), then a final task swaps the layout to a two-row grid with a `LeftPanel` tab container and full-width `Timeline`. The render pipeline (`lib/webcodecsRender.js`), transitions/captions libraries, and clip-inspector behavior are unchanged.

**Tech Stack:** Next.js 14 (App Router), React 18, plain CSS in `app/globals.css` (design tokens), vitest for `lib/` unit tests.

---

## Verification approach (read first)

This is a UI refactor that adds **no new logic**, and the project has **no React component test harness** (vitest only covers `lib/`). Per the spec, adding a testing-library stack is out of scope. So each task is **verification-driven**, gated by:

- **`npx vitest run`** → must stay **41 passed** (guards the untouched `lib/`; catches accidental edits there).
- **`npm run build`** → must compile with no errors (catches broken imports/JSX/undeclared identifiers — the real regression guard for a move refactor).
- **Visual check** → `npm run dev`, open the editor, confirm the described UI is intact.

TDD's red-green loop does not map to moving JSX between files; these three gates are the honest equivalent. Run vitest + build after every task before committing.

## File structure

Created:
- `lib/format.js` — shared `tc` (mm:ss.d) and `clock` (m:ss) time formatters (currently duplicated inside `Editor.js`).
- `components/panels/ExportPanel.js` — right-column Export panel.
- `components/panels/TransitionsPanel.js` — transitions UI (owns its own random-mix state).
- `components/panels/MotionPanel.js` — Ken Burns zoom + Scene fades.
- `components/panels/CaptionsPanel.js` — captions UI (owns its caption-file input).
- `components/panels/EffectsPanel.js` — "Coming soon" stub.
- `components/InspectorModal.js` — the clip inspector modal (owns its replacement-pick state).
- `components/LeftPanel.js` — tab strip + active-tab body.

Modified:
- `components/Editor.js` — becomes the thin layout shell; keeps canvas draw / audio playback / keyboard / selection logic; distributes props to the new components.
- `app/globals.css` — add new layout/tab classes; remove dead `.side`/`.main` rules at the end.

Unchanged: `app/page.js`, everything in `lib/` except the new `lib/format.js`, `components/Timeline.js`.

---

### Task 1: CSS foundation for the new layout

**Files:**
- Modify: `app/globals.css` (add a new section near the `.editor` block, ~line 278)

- [ ] **Step 1: Add the new layout + tab classes**

Add this block to `app/globals.css` immediately after the existing `.viewer__canvas` rule (around line 296), before `/* Panels */`:

```css
/* ---------- CapCut-style shell: tabbed left panel + full-width timeline ---------- */
.editor2 {
  flex: 1; min-height: 0; width: 100%;
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr) 320px;
  grid-template-rows: minmax(0, 1fr) auto;
  grid-template-areas:
    "left center right"
    "timeline timeline timeline";
  gap: 12px;
}
.editor2__left { grid-area: left; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.editor2__center { grid-area: center; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
.editor2__right { grid-area: right; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 2px; }
.editor2__timeline { grid-area: timeline; }

/* Left panel: tab strip + scrollable body, wrapped in a panel surface */
.leftpanel { flex: 1; min-height: 0; display: flex; flex-direction: column;
  background: var(--panel); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
.tabs { flex: none; display: flex; gap: 6px; padding: 10px 10px 0; overflow-x: auto; }
.tab {
  flex: none; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--muted);
  background: transparent; border: 1px solid transparent; border-radius: 9px 9px 0 0;
  padding: 8px 12px; cursor: pointer; white-space: nowrap;
  transition: color .12s, background .12s, border-color .12s;
}
.tab:hover { color: var(--text); }
.tab.is-on { color: var(--accent); background: var(--panel-2); border-color: var(--line); border-bottom-color: var(--panel-2); }
.tabpanel { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; border-top: 1px solid var(--line); }

/* Effects tab placeholder */
.effects-soon {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  min-height: 220px; text-align: center; color: var(--muted);
  border: 1.5px dashed var(--line); border-radius: 12px; padding: 24px; background: var(--panel-2);
}
.effects-soon__title { font-size: 14px; font-weight: 700; color: var(--text); }
.effects-soon__sub { font-size: 12.5px; color: var(--faint); max-width: 240px; line-height: 1.5; }

/* Responsive: stack the shell on narrow screens */
@media (max-width: 860px) {
  .editor2 {
    display: flex; flex-direction: column;
  }
  .editor2__right { overflow: visible; }
  .leftpanel { flex: none; }
  .tabpanel { max-height: 60vh; }
}
```

- [ ] **Step 2: Verify build + tests**

Run: `npx vitest run` — Expected: `41 passed`.
Run: `npm run build` — Expected: compiles, no errors (the new CSS is unused so far, which is fine).

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "Add CSS for CapCut-style tabbed shell layout"
```

---

### Task 2: Extract shared time formatters into lib/format.js

**Files:**
- Create: `lib/format.js`
- Modify: `components/Editor.js` (remove the local `tc`/`clock`, import them instead)

- [ ] **Step 1: Create `lib/format.js`**

```js
// Shared time formatters for the editor UI.
// tc: "mm:ss.d" (playhead / durations). clock: "m:ss" (elapsed / ETA).
export function tc(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const d = Math.floor((t * 10) % 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`;
}

export function clock(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
```

- [ ] **Step 2: Use it in `Editor.js`**

In `components/Editor.js`, delete the local `function tc(...)` (lines ~12-18) and `function clock(...)` (lines ~20-25). Add to the import block near the top:

```js
import { tc, clock } from "../lib/format";
```

- [ ] **Step 3: Verify build + tests**

Run: `npx vitest run` — Expected: `41 passed`.
Run: `npm run build` — Expected: compiles, no errors.
Visual: `npm run dev`, open the editor — the playhead time, export length, and render ETA still format identically.

- [ ] **Step 4: Commit**

```bash
git add lib/format.js components/Editor.js
git commit -m "Extract tc/clock time formatters into lib/format.js"
```

---

### Task 3: Extract ExportPanel

The Export panel is the `<div className="panel export">…</div>` block in `Editor.js` (currently ~lines 478-575). It renders in the right column and uses these values computed in `Editor`: `imageCount`, `gapCount`, `exportDuration`, `duration`, `dims`, `renderDims`, `elapsed`, plus the render/export props and `tc`/`clock`.

**Files:**
- Create: `components/panels/ExportPanel.js`
- Modify: `components/Editor.js`

- [ ] **Step 1: Create `components/panels/ExportPanel.js`**

Move the `<div className="panel export">…</div>` JSX verbatim into this component's return (keep the disabled `false && wcAvailable …` fast-render toggle block as-is). Component signature:

```js
import { tc, clock } from "../../lib/format";

export default function ExportPanel({
  aspect, setAspect, fps, setFps,
  renderQuality, setRenderQuality, renderDims, dims,
  imageCount, gapCount, exportDuration, duration, elapsed,
  wcAvailable, serverAvailable, busy, wcBusy, wcPhase, wcProgress, progress,
  wcEnabled, setWcEnabled,
  onWebCodecsTest, onRender, onWebCodecsCancel, onCancel,
  outUrl, error,
}) {
  return (
    /* … the exact <div className="panel export"> … </div> block moved from Editor.js … */
  );
}
```

- [ ] **Step 2: Render it in `Editor.js`**

In `Editor.js`, replace the removed `<div className="panel export">…</div>` (inside `<aside className="side">`) with:

```jsx
<ExportPanel
  aspect={aspect} setAspect={setAspect} fps={fps} setFps={setFps}
  renderQuality={renderQuality} setRenderQuality={setRenderQuality} renderDims={renderDims} dims={dims}
  imageCount={imageCount} gapCount={gapCount} exportDuration={exportDuration} duration={duration} elapsed={elapsed}
  wcAvailable={wcAvailable} serverAvailable={serverAvailable} busy={busy} wcBusy={wcBusy}
  wcPhase={wcPhase} wcProgress={wcProgress} progress={progress}
  wcEnabled={wcEnabled} setWcEnabled={setWcEnabled}
  onWebCodecsTest={onWebCodecsTest} onRender={onRender} onWebCodecsCancel={onWebCodecsCancel} onCancel={onCancel}
  outUrl={outUrl} error={error}
/>
```

Add the import at the top of `Editor.js`:

```js
import ExportPanel from "./panels/ExportPanel";
```

- [ ] **Step 3: Verify build + tests**

Run: `npx vitest run` — Expected: `41 passed`.
Run: `npm run build` — Expected: compiles, no errors.
Visual: export controls (aspect/fps/quality), specs, gap note, Render button, progress, download link, and errors all look and work exactly as before.

- [ ] **Step 4: Commit**

```bash
git add components/panels/ExportPanel.js components/Editor.js
git commit -m "Extract ExportPanel from Editor.js"
```

---

### Task 4: Extract TransitionsPanel

The Transitions panel is `<div className="panel transitions">…</div>` in `Editor.js` (~lines 577-648). It owns the random-mix UI. Selection (`selectedCut`, `currentType`) is driven by clicking cut markers in `Timeline`, so it **stays in Editor** and is passed down; the `mixMode`/`mixPicks`/`toggleMix` state **moves into this panel** (purely local).

**Files:**
- Create: `components/panels/TransitionsPanel.js`
- Modify: `components/Editor.js`

- [ ] **Step 1: Create `components/panels/TransitionsPanel.js`**

Move mix state in and the panel JSX verbatim:

```js
import { useCallback, useState } from "react";
import { tc } from "../../lib/format";
import {
  TRANSITION_LIST, transitionOf,
  MIN_TRANSITION_DURATION, MAX_TRANSITION_DURATION,
} from "../../lib/transitions";

export default function TransitionsPanel({
  clips, selectedIndex, selectedClip, selectedImageNum,
  currentType, pickType,
  transitionDuration, setTransitionDuration,
  applyTransitionAll, applyTransitionMix,
}) {
  const [mixMode, setMixMode] = useState(false);
  const [mixPicks, setMixPicks] = useState(() => new Set());
  const toggleMix = useCallback((id) => {
    setMixPicks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return (
    /* … the exact <div className="panel transitions"> … </div> block moved from Editor.js,
       using the local mixMode/mixPicks/toggleMix and the props above … */
  );
}
```

- [ ] **Step 2: Update `Editor.js`**

Delete the `mixMode`, `mixPicks`, `toggleMix` declarations from `Editor.js` (~lines 76-84). Keep `selectedCut`, `currentType`, `selectClip`, `pickType`, and the derived `selectedClip`/`selectedIndex`/`selectedImageNum`. Replace the `<div className="panel transitions">…</div>` with:

```jsx
<TransitionsPanel
  clips={clips}
  selectedIndex={selectedIndex} selectedClip={selectedClip} selectedImageNum={selectedImageNum}
  currentType={currentType} pickType={pickType}
  transitionDuration={transitionDuration} setTransitionDuration={setTransitionDuration}
  applyTransitionAll={applyTransitionAll} applyTransitionMix={applyTransitionMix}
/>
```

Add the import:

```js
import TransitionsPanel from "./panels/TransitionsPanel";
```

Remove the now-unused `TRANSITION_LIST`, `transitionOf`, `MIN_TRANSITION_DURATION`, `MAX_TRANSITION_DURATION` from `Editor.js`'s import of `../lib/transitions` **only if nothing else in Editor.js uses them** — `transitionOf` is still used by the `draw` function, so keep `transitionOf`; drop `TRANSITION_LIST`, `MIN_TRANSITION_DURATION`, `MAX_TRANSITION_DURATION`.

- [ ] **Step 3: Verify build + tests**

Run: `npx vitest run` — Expected: `41 passed`.
Run: `npm run build` — Expected: compiles, no errors.
Visual: select a cut marker on the timeline → the panel shows the target line; picking a chip sets the transition; duration slider, "Apply to all", and Random-mix toggle + apply all work as before.

- [ ] **Step 4: Commit**

```bash
git add components/panels/TransitionsPanel.js components/Editor.js
git commit -m "Extract TransitionsPanel from Editor.js"
```

---

### Task 5: Extract MotionPanel (Ken Burns + Scene fades)

Move the two panels `<div className="panel">…Motion — Ken Burns zoom…</div>` (~lines 650-667) and `<div className="panel">…Scene fades…</div>` (~lines 669-682) into one component (two `.panel` sections).

**Files:**
- Create: `components/panels/MotionPanel.js`
- Modify: `components/Editor.js`

- [ ] **Step 1: Create `components/panels/MotionPanel.js`**

```js
export default function MotionPanel({
  imageClips,
  motionAmount, setMotionAmount,
  applyMotionAll, applyMotionAlternate,
  fadeIn, setFadeIn, fadeOut, setFadeOut,
}) {
  return (
    <>
      {/* … the exact Motion — Ken Burns zoom <div className="panel">…</div> … */}
      {/* … the exact Scene fades <div className="panel">…</div> … */}
    </>
  );
}
```

Inside, the Ken Burns buttons call `applyMotionAll("zoomin", imageClips.map((c) => c.name))` etc. — use the `imageClips` prop exactly as `Editor.js` does today.

- [ ] **Step 2: Update `Editor.js`**

Replace both `.panel` blocks with:

```jsx
<MotionPanel
  imageClips={imageClips}
  motionAmount={motionAmount} setMotionAmount={setMotionAmount}
  applyMotionAll={applyMotionAll} applyMotionAlternate={applyMotionAlternate}
  fadeIn={fadeIn} setFadeIn={setFadeIn} fadeOut={fadeOut} setFadeOut={setFadeOut}
/>
```

Add the import:

```js
import MotionPanel from "./panels/MotionPanel";
```

- [ ] **Step 3: Verify build + tests**

Run: `npx vitest run` — Expected: `41 passed`.
Run: `npm run build` — Expected: compiles, no errors.
Visual: zoom-depth slider, Zoom in/out all, Alternate, Clear, and both fade sliders behave as before.

- [ ] **Step 4: Commit**

```bash
git add components/panels/MotionPanel.js components/Editor.js
git commit -m "Extract MotionPanel (Ken Burns + scene fades) from Editor.js"
```

---

### Task 6: Extract CaptionsPanel

Move `<div className="panel captions">…</div>` (~lines 684-781) into its own component. The caption **file input + its ref move into the panel** (self-contained upload).

**Files:**
- Create: `components/panels/CaptionsPanel.js`
- Modify: `components/Editor.js`

- [ ] **Step 1: Create `components/panels/CaptionsPanel.js`**

```js
import { useCallback, useRef } from "react";
import {
  CAPTION_STYLE_LIST, CAPTION_SIZES, captionLineHeightDefault,
} from "../../lib/captions";

export default function CaptionsPanel({
  captionCues, captionsOn, setCaptionsOn,
  captionStyle, setCaptionStyle,
  captionSize, setCaptionSize,
  captionLineHeight, setCaptionLineHeight,
  captionFontScale, setCaptionFontScale,
  captionName, captionError, onCaptionFile,
}) {
  const capInputRef = useRef(null);
  const onPickCaption = useCallback((e) => {
    const file = e.target.files && e.target.files[0];
    if (file && onCaptionFile) onCaptionFile(file);
    e.target.value = "";
  }, [onCaptionFile]);

  return (
    <>
      {/* … the exact <div className="panel captions">…</div> block moved from Editor.js … */}
      <input
        ref={capInputRef} type="file" accept=".srt,.vtt,.txt,text/plain" hidden
        onChange={onPickCaption}
      />
    </>
  );
}
```

- [ ] **Step 2: Update `Editor.js`**

Remove `capInputRef`, `onPickCaption`, and the caption `<input ref={capInputRef} …>` from `Editor.js`. Remove the `CAPTION_STYLE_LIST, CAPTION_SIZES, captionAt, drawCaption, captionFontPx, captionLineHeightDefault` import line **selectively**: `captionAt`, `drawCaption`, `captionFontPx` are still used by `draw`, so keep those; drop `CAPTION_STYLE_LIST`, `CAPTION_SIZES`, `captionLineHeightDefault` (now used only by the panel). Replace the captions `.panel` with:

```jsx
<CaptionsPanel
  captionCues={captionCues} captionsOn={captionsOn} setCaptionsOn={setCaptionsOn}
  captionStyle={captionStyle} setCaptionStyle={setCaptionStyle}
  captionSize={captionSize} setCaptionSize={setCaptionSize}
  captionLineHeight={captionLineHeight} setCaptionLineHeight={setCaptionLineHeight}
  captionFontScale={captionFontScale} setCaptionFontScale={setCaptionFontScale}
  captionName={captionName} captionError={captionError} onCaptionFile={onCaptionFile}
/>
```

Add the import:

```js
import CaptionsPanel from "./panels/CaptionsPanel";
```

- [ ] **Step 3: Verify build + tests**

Run: `npx vitest run` — Expected: `41 passed`.
Run: `npm run build` — Expected: compiles, no errors.
Visual: upload a transcript, toggle captions on/off, change style/size/font-scale/line-spacing, and "replace" — all as before.

- [ ] **Step 4: Commit**

```bash
git add components/panels/CaptionsPanel.js components/Editor.js
git commit -m "Extract CaptionsPanel from Editor.js"
```

---

### Task 7: Create EffectsPanel stub

**Files:**
- Create: `components/panels/EffectsPanel.js`

- [ ] **Step 1: Create `components/panels/EffectsPanel.js`**

```js
export default function EffectsPanel() {
  return (
    <div className="effects-soon">
      <div className="effects-soon__title">✨ Atmosphere &amp; Genre FX</div>
      <div className="effects-soon__sub">
        Color grading, lighting filters, fog &amp; particles for storytelling — coming soon.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build + tests**

Run: `npx vitest run` — Expected: `41 passed`.
Run: `npm run build` — Expected: compiles, no errors (component is unused until Task 9; that's fine).

- [ ] **Step 3: Commit**

```bash
git add components/panels/EffectsPanel.js
git commit -m "Add EffectsPanel stub (Coming soon)"
```

---

### Task 8: Extract InspectorModal

Move the entire clip inspector — the `{inspect && (() => { … })()}` IIFE block (~lines 798-960) — into its own component, along with the replacement-pick state (`pendFile`, `pendUrl`, `clearPend`, `onPickReplacement`, `applyReplacement`, `removeInspected`, `replaceInputRef`, `modalVideoRef`) and the Escape-to-close effect. `Editor` keeps only `inspect`/`setInspect` plus `openInspect`/`closeInspect` (closeInspect must also clear pend — so the clear lives in the modal; see below).

**Files:**
- Create: `components/InspectorModal.js`
- Modify: `components/Editor.js`

- [ ] **Step 1: Create `components/InspectorModal.js`**

The component owns pend state and closes itself. Signature:

```js
import { useCallback, useEffect, useRef, useState } from "react";
import { tc } from "../lib/format";

export default function InspectorModal({
  inspect, onClose,
  clips, imageEls, imageClips, imageCount,
  videoInfoByName, volumeByName, setVolume,
  trimByName, setTrim, fitByName, setFit,
  motionByName, setMotion,
  replaceImage, removeImage,
}) {
  const replaceInputRef = useRef(null);
  const modalVideoRef = useRef(null);
  const [pendFile, setPendFile] = useState(null);
  const [pendUrl, setPendUrl] = useState(null);

  const clearPend = useCallback(() => {
    setPendUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
    setPendFile(null);
  }, []);
  const close = useCallback(() => { clearPend(); onClose(); }, [clearPend, onClose]);

  const onPickReplacement = useCallback((e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !(file.type.startsWith("image/") || file.type.startsWith("video/"))) return;
    setPendFile(file);
    setPendUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(file); });
  }, []);
  const applyReplacement = useCallback(() => {
    if (inspect && pendFile && replaceImage) replaceImage(inspect, pendFile);
    close();
  }, [inspect, pendFile, replaceImage, close]);
  const removeInspected = useCallback(() => {
    if (inspect && removeImage) removeImage(inspect);
    close();
  }, [inspect, removeImage, close]);

  useEffect(() => {
    if (!inspect) return;
    const onEsc = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [inspect, close]);

  if (!inspect) return null;

  // … the body of the existing IIFE (const insClip = …; return (<div className="modal" onClick={close}> … </div>))
  //   moved here verbatim, with these renames:
  //     closeInspect      -> close
  //     clearPend         -> clearPend   (unchanged)
  //     the hidden <input ref={replaceInputRef} … onChange={onPickReplacement}> that lived in Editor.js
  //     moves INTO this component's returned markup (place it just inside the outer fragment/div).
  const insClip = clips.find((c) => c.name === inspect);
  /* … rest of the existing block, returning the modal markup … */
}
```

Note: the existing hidden `<input ref={replaceInputRef} …>` (currently ~lines 789-792 in `Editor.js`) must be rendered inside `InspectorModal` (wrap the modal `return` in a fragment that also renders the input), since `replaceInputRef` now lives here.

- [ ] **Step 2: Update `Editor.js`**

In `Editor.js`: delete `pendFile`, `pendUrl`, `clearPend`, `onPickReplacement`, `applyReplacement`, `removeInspected`, `replaceInputRef`, `modalVideoRef`, and the Escape-key `useEffect` for the inspector. Keep `inspect`/`setInspect`. Simplify:

```js
const openInspect = useCallback((name) => setInspect(name), []);
const closeInspect = useCallback(() => setInspect(null), []);
```

Delete the hidden `<input ref={replaceInputRef} …>`. Replace the whole `{inspect && (() => { … })()}` block with:

```jsx
<InspectorModal
  inspect={inspect} onClose={closeInspect}
  clips={clips} imageEls={imageEls} imageClips={imageClips} imageCount={imageCount}
  videoInfoByName={videoInfoByName} volumeByName={volumeByName} setVolume={setVolume}
  trimByName={trimByName} setTrim={setTrim} fitByName={fitByName} setFit={setFit}
  motionByName={motionByName} setMotion={setMotion}
  replaceImage={replaceImage} removeImage={removeImage}
/>
```

Add the import:

```js
import InspectorModal from "./InspectorModal";
```

- [ ] **Step 3: Verify build + tests**

Run: `npx vitest run` — Expected: `41 passed`.
Run: `npm run build` — Expected: compiles, no errors.
Visual: click a clip → modal opens; motion buttons, fit/trim (for videos), volume, Replace (image & video), Choose different, Cancel, Remove, Esc-to-close, and click-outside-to-close all work as before.

- [ ] **Step 4: Commit**

```bash
git add components/InspectorModal.js components/Editor.js
git commit -m "Extract InspectorModal from Editor.js"
```

---

### Task 9: Create LeftPanel tab container

A dumb tab container: takes an array of `{ id, label, node }` and shows the active one. Default active = first tab.

**Files:**
- Create: `components/LeftPanel.js`

- [ ] **Step 1: Create `components/LeftPanel.js`**

```js
import { useState } from "react";

export default function LeftPanel({ tabs }) {
  const [active, setActive] = useState(tabs[0] ? tabs[0].id : null);
  const current = tabs.find((t) => t.id === active) || tabs[0];
  return (
    <div className="leftpanel">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active}
            className={`tab ${t.id === active ? "is-on" : ""}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel">
        {current ? current.node : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build + tests**

Run: `npx vitest run` — Expected: `41 passed`.
Run: `npm run build` — Expected: compiles, no errors (unused until Task 10).

- [ ] **Step 3: Commit**

```bash
git add components/LeftPanel.js
git commit -m "Add LeftPanel tab container"
```

---

### Task 10: Rewire Editor into the two-row shell

Swap the `.editor`/`.main`/`.side` structure for `.editor2`. Put the four panels into `LeftPanel` (tabs: Motion / Transitions / Captions / Effects), keep the viewer + transport + warnings in the center, put `ExportPanel` on the right, and the `Timeline` full-width at the bottom. `InspectorModal` and the remaining hidden file input(s) stay rendered at the end.

**Files:**
- Modify: `components/Editor.js`

- [ ] **Step 1: Restructure the `return` of `Editor.js`**

Replace the top-level `<section className="editor"> … </section>` structure. The new shape:

```jsx
<section className="editor2">
  <div className="editor2__left">
    <LeftPanel
      tabs={[
        { id: "motion", label: "Motion", node: (
          <MotionPanel
            imageClips={imageClips}
            motionAmount={motionAmount} setMotionAmount={setMotionAmount}
            applyMotionAll={applyMotionAll} applyMotionAlternate={applyMotionAlternate}
            fadeIn={fadeIn} setFadeIn={setFadeIn} fadeOut={fadeOut} setFadeOut={setFadeOut}
          />
        ) },
        { id: "transitions", label: "Transitions", node: (
          <TransitionsPanel
            clips={clips}
            selectedIndex={selectedIndex} selectedClip={selectedClip} selectedImageNum={selectedImageNum}
            currentType={currentType} pickType={pickType}
            transitionDuration={transitionDuration} setTransitionDuration={setTransitionDuration}
            applyTransitionAll={applyTransitionAll} applyTransitionMix={applyTransitionMix}
          />
        ) },
        { id: "captions", label: "Captions", node: (
          <CaptionsPanel
            captionCues={captionCues} captionsOn={captionsOn} setCaptionsOn={setCaptionsOn}
            captionStyle={captionStyle} setCaptionStyle={setCaptionStyle}
            captionSize={captionSize} setCaptionSize={setCaptionSize}
            captionLineHeight={captionLineHeight} setCaptionLineHeight={setCaptionLineHeight}
            captionFontScale={captionFontScale} setCaptionFontScale={setCaptionFontScale}
            captionName={captionName} captionError={captionError} onCaptionFile={onCaptionFile}
          />
        ) },
        { id: "effects", label: "Effects", node: <EffectsPanel /> },
      ]}
    />
  </div>

  <div className="editor2__center">
    <div className="viewer">
      <div className="viewer__frame">
        <canvas ref={canvasRef} width={dims.width} height={dims.height} className="viewer__canvas" />
      </div>
      <div className="transport">
        {/* … the existing transport bar JSX unchanged … */}
      </div>
      <audio ref={audioRef} src={audioUrl} hidden />
    </div>
    {/* … the existing warnings block (the IIFE that filters dismissedWarn) unchanged … */}
  </div>

  <div className="editor2__right">
    <ExportPanel
      aspect={aspect} setAspect={setAspect} fps={fps} setFps={setFps}
      renderQuality={renderQuality} setRenderQuality={setRenderQuality} renderDims={renderDims} dims={dims}
      imageCount={imageCount} gapCount={gapCount} exportDuration={exportDuration} duration={duration} elapsed={elapsed}
      wcAvailable={wcAvailable} serverAvailable={serverAvailable} busy={busy} wcBusy={wcBusy}
      wcPhase={wcPhase} wcProgress={wcProgress} progress={progress}
      wcEnabled={wcEnabled} setWcEnabled={setWcEnabled}
      onWebCodecsTest={onWebCodecsTest} onRender={onRender} onWebCodecsCancel={onWebCodecsCancel} onCancel={onCancel}
      outUrl={outUrl} error={error}
    />
  </div>

  <div className="editor2__timeline">
    <Timeline
      clips={clips} imageEls={imageEls} duration={duration} time={time} peaks={peaks}
      activeName={active && active.name} badClips={badClips}
      transitionsByName={transitionsByName} motionByName={motionByName}
      selectedName={selectedCut} onSelect={selectClip} onSeek={seek}
      onScrubStart={onScrubStart} onScrubEnd={onScrubEnd}
      onOpen={openInspect} onAdd={askAdd} onResizeBoundary={resizeBoundary}
      trimEnd={trimEnd} onTrimChange={setTrimEnd}
    />
  </div>

  {/* hidden inputs that remain in Editor (gap-fill picker) */}
  <input
    ref={fileInputRef} type="file" accept={coarse ? undefined : "image/*,video/*"} hidden
    onChange={onPickFile}
  />

  <InspectorModal
    inspect={inspect} onClose={closeInspect}
    clips={clips} imageEls={imageEls} imageClips={imageClips} imageCount={imageCount}
    videoInfoByName={videoInfoByName} volumeByName={volumeByName} setVolume={setVolume}
    trimByName={trimByName} setTrim={setTrim} fitByName={fitByName} setFit={setFit}
    motionByName={motionByName} setMotion={setMotion}
    replaceImage={replaceImage} removeImage={removeImage}
  />
</section>
```

Keep every ref (`canvasRef`, `audioRef`, `fileInputRef`) and all the existing effects/handlers in `Editor.js` unchanged — only the JSX layout changes. Confirm imports for `MotionPanel`, `TransitionsPanel`, `CaptionsPanel`, `EffectsPanel`, `ExportPanel`, `LeftPanel`, `InspectorModal`, and `Timeline` are all present.

- [ ] **Step 2: Verify build + tests**

Run: `npx vitest run` — Expected: `41 passed`.
Run: `npm run build` — Expected: compiles, no errors.
Visual (`npm run dev`): editor shows tabbed left panel (Motion default), center preview + transport, right Export, full-width bottom timeline. Switch tabs; confirm each panel works. Play/scrub, select cut markers (Transitions tab reflects selection), open a clip (modal), render — all functional.

- [ ] **Step 3: Commit**

```bash
git add components/Editor.js
git commit -m "Rewire Editor into CapCut-style two-row shell with tabbed left panel"
```

---

### Task 11: Remove dead CSS and final verification

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Remove now-unused layout rules**

In `app/globals.css`, delete the old editor-layout rules that nothing renders anymore: `.editor` (the `grid-template-columns: minmax(0,1fr) 320px` one, ~line 279-282), `.main` (~283), `.side` (~284). Keep `.viewer`, `.panel`, `.transport`, the Export/Transitions/Captions/Timeline/modal rules — all still used. Also update the `@media (max-width: 860px)` block: remove the `.editor`/`.side`/`.main` overrides (~lines 745-747) since those selectors are gone; the new `.editor2` responsive rules from Task 1 handle stacking.

Grep to confirm nothing else references the removed selectors:

Run: `grep -rn "className=\"\(editor\|main\|side\)\"" components app` — Expected: no matches (only `.editor2*` remain).

- [ ] **Step 2: Full verification**

Run: `npx vitest run` — Expected: `41 passed`.
Run: `npm run build` — Expected: compiles, no errors.
Visual desktop: full shell renders correctly; all four tabs; export; timeline full-width; modal; playback.
Visual mobile (DevTools ~400px): columns stack (tabs → preview → export → timeline); tab strip scrolls horizontally; timeline scrolls; no horizontal page overflow.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "Remove dead .editor/.main/.side CSS after shell rewire"
```

---

## Self-review notes

- **Spec coverage:** layout structure (Tasks 1,10), responsive (Tasks 1,11), four tabs + Effects stub (Tasks 7,9), content mapping incl. scene-fades-in-Motion (Task 5), component decomposition (Tasks 2-9), styling from tokens (Task 1), inspector unchanged (Task 8), no render-pipeline change (no task touches `lib/webcodecsRender.js`/`serverRender.js`/`transitions.js`/`captions.js`). All covered.
- **Prop-name consistency:** panel prop names match their `<Editor>`-side values one-to-one; `onClose`/`close` in InspectorModal replace `closeInspect`; `pickType`/`currentType`/`selectedIndex`/`selectedClip`/`selectedImageNum` remain Editor-owned and passed to TransitionsPanel.
- **Selective imports:** `transitionOf` (used by `draw`) and `captionAt`/`drawCaption`/`captionFontPx` (used by `draw`) are intentionally kept in `Editor.js` while their sibling exports move to the panels — called out in Tasks 4 and 6 to avoid an "unused import" / "missing import" mismatch.
- **Incremental safety:** Tasks 2-8 extract components while the OLD layout still renders them, so every commit ships a working app; Task 10 only repositions already-extracted components.
