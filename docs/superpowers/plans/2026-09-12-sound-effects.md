# Sound Effects Implementation Plan (Spec #5)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) tracking.

**Goal:** Free-positioned sound effects on a timeline FX track, from a bundled CC0 pack + user uploads, playing in preview and mixed into the WebCodecs export.

**Architecture:** A bundle-time WAV generator + `lib/sfx.js` manifest; `sfx[]` placed-instance state in `page.js`; a new FX lane in `Timeline`; a 5th "Audio" left tab; a Web Audio preview scheduler (`lib/sfxScheduler.js`); and SFX entries added to the existing `clipMixes` in `webcodecsRender`.

**Verification:** `npx vitest run` (stay green) + live dev server (curl 200, read compile output). No `next build` while dev runs. Full build only in the last task (dev stopped).

---

### Task 1: Bundle CC0 SFX (`scripts/gen-sfx.mjs` → `public/sfx/`)

- [ ] Create `scripts/gen-sfx.mjs` — dependency-free WAV synthesizer writing mono 44.1kHz 16-bit PCM files: `whoosh.wav, swoosh.wav, pop.wav, ding.wav, click.wav, boom.wav`. (Full script provided in the implementation; uses only `node:fs`.)
- [ ] Run `node scripts/gen-sfx.mjs` → files appear in `public/sfx/`.
- [ ] Verify each file: `ls -la public/sfx` (nonzero sizes) and header `RIFF....WAVE`.
- [ ] Commit: `git add scripts/gen-sfx.mjs public/sfx && git commit -m "Generate bundled CC0 SFX pack"`

### Task 2: Library manifest (`lib/sfx.js`)

- [ ] `SFX_LIBRARY = [{id,label,file}]` for the 6 sounds (`file: "/sfx/<id>.wav"`).
- [ ] `sfxLibUrl(file)` passthrough; `makeSfx(name, src, at)` → `{ id:newId(), name, at, volume:0.8, src }` (uuid via a local counter or crypto).
- [ ] Verify vitest + dev compile. Commit.

### Task 3: Preview scheduler (`lib/sfxScheduler.js`)

- [ ] A singleton-ish module: lazy `AudioContext`, `loadBuffer(url)` (fetch→decode, cached Map), `resume()`, `preview(url, volume)` (one-shot), `fireAt(url, volume)` returning a source added to an active set, and `stopAll()`.
- [ ] Verify vitest + dev compile. Commit.

### Task 4: State + persistence (`app/page.js`)

- [ ] `const [sfx, setSfx] = useState([])` and `const [selectedSound, setSelectedSound] = useState(null)` (selected library sound id for placement).
- [ ] Setters: `addSfx(sound, at)`, `moveSfx(id, at)`, `setSfxVolume(id, v)`, `removeSfx(id)`, `uploadSfx(file)` (→ `putMedia(projectId, mediaId, file)`, add an `upload` instance; create objectURL).
- [ ] Resolve a runtime `url` for each instance (lib path, or objectURL from `getMedia`) — a `sfxResolved` memo used by preview + render.
- [ ] Reset: `setSfx([])`. Persist: add `sfx` (serializable: strip `url`, keep `src`/`at`/`volume`/`name`) to the doc + dep arrays. Restore: rebuild `sfx` (re-create objectURLs from media for uploads). Add upload `mediaId`s to the media-wanted set for `syncMedia`.
- [ ] Both render specs: pass `sfx: sfxResolved` (each `{ url, at, volume }`) + dep arrays.
- [ ] Pass to `<Editor>`: `sfx`, setters, `selectedSound`, `setSelectedSound`, `sfxResolved`.
- [ ] Verify vitest + dev compile. Commit.

### Task 5: Timeline FX track (`components/Timeline.js`)

- [ ] New props: `sfx`, `sfxResolved`, `onSfxAdd`, `onSfxMove`, `onSfxOpen`.
- [ ] Add an **FX** gutter tag and a `.tl__lane--fx` lane after the audio lane.
- [ ] Render a marker per instance at `left: pct(at)`; label = name; pointer-drag → `onSfxMove(id, secAt(x))` (snap to clip boundaries, clamp 0..duration); clean click → `onSfxOpen(id)`.
- [ ] Empty-lane click → `onSfxAdd(secAt(x))`.
- [ ] CSS in `globals.css`: `.tl__lane--fx`, `.sfxmark`, `.tl__tag--fx` (silver-on-black, matches existing timeline styles).
- [ ] Verify vitest + dev compile. Commit.

### Task 6: Audio tab + editor wiring

- [ ] `components/panels/AudioPanel.js`: bundled + uploaded list with ▶ preview (via scheduler.preview) and select (highlight `selectedSound`); Upload button; hint text.
- [ ] `Editor.js`: import scheduler + AudioPanel; add the 5th tab; hold `prevTimeRef` and, in the playback rAF loop, fire crossed SFX and `stopAll()` on pause/seek/scrub; pass FX-track props to `Timeline`; render a small SFX edit popover/modal (volume slider + remove) when a marker is opened.
- [ ] Verify vitest + dev compile. Commit.

### Task 7: Export mixing (`lib/webcodecsRender.js`)

- [ ] Destructure `sfx = []` from `spec`.
- [ ] Add a `prepareSfxMixes()` (decode each `sfx[i].url` via the existing tiny OAC, place whole buffer at `Math.floor(at*mixRate)`, `vol`) → push into `clipMixes`.
- [ ] Extend `wantAudio` so SFX-only projects still encode audio.
- [ ] Verify vitest + dev compile. Commit.

### Task 8: Final verification

- [ ] `npx vitest run` green; dev Audio tab: preview, place, drag, edit, remove; render an MP4 and confirm SFX audible at the right times.
- [ ] Stop dev; `npm run build` clean; restart dev.

## Self-review notes
- Export reuses `clipMixes`/`pumpAudioTo` (T7); scheduler is preview-only (T3/T6).
- Uploaded SFX persist via the media store (T4), mirroring clip images.
- `wantAudio` must include SFX-only case (T7) or a no-voiceover project drops SFX.
