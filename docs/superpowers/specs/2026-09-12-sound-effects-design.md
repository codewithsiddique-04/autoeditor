# Sound Effects — Design (Spec #5)

**Date:** 2026-09-12
**Branch:** `redesign/sound-effects` (new, off `main`)
**Status:** Approved for planning

## Context

Spec #5 of the redesign. Adds a **sound-effects** subsystem: place free-positioned
SFX anywhere on the timeline, from a bundled CC0 library or user uploads, playing
in the preview and mixed into the exported MP4. Today the app has only the
voiceover track + per-clip video audio; there is no SFX concept and no general
audio-track UI.

### Architectural facts

- **Export mixing is easy.** `lib/webcodecsRender.js` already builds
  `clipMixes` (per-clip audio placed at a sample offset with a volume) and mixes
  them window-by-window in `pumpAudioTo` (`for (const cm of clipMixes)`). A sound
  effect is one more `{ chans, at, vol }` entry in that same list.
- **Preview scheduling is the real work.** The preview playhead is driven by a
  single `<audio>` element (the voiceover); `time` = `audio.currentTime` via rAF.
  SFX need a small Web Audio scheduler that fires each effect when the playhead
  crosses its time and stops on pause/seek/scrub.
- **Media store exists** for uploads: `putMedia/getMedia/deleteMedia/listMediaIds/
  syncMedia/newId` in `lib/projectStore.js` (same path used for clip images/audio).
- **Node v24** is available for a bundle-time WAV generator, so the CC0 pack is
  authored locally (no external download / licensing ambiguity).

## Decisions (from brainstorming)

1. **Free timeline placement**: a dedicated FX track; effects sit at any time and
   drag to reposition.
2. **Source**: bundled CC0 pack **+** user upload (.mp3/.wav).
3. **Library UI**: a **5th left tab, "Audio."**
4. **Placement interaction**: select a sound in the Audio tab, **click the FX lane**
   to drop it there; drag a marker to move; click a marker to edit volume / remove.

## Design

### 1. CC0 pack — `scripts/gen-sfx.mjs` + `public/sfx/`

A dependency-free Node script synthesizes a small set of WAV one-shots (mono,
44.1 kHz, 16-bit PCM) into `public/sfx/`: `whoosh`, `swoosh`, `pop`, `ding`,
`click`, `boom`. Authored by us → CC0, offline, no network. Re-runnable via
`node scripts/gen-sfx.mjs`.

### 2. Library manifest — `lib/sfx.js`

- `SFX_LIBRARY = [{ id, label, file }]` for the bundled pack (file = `/sfx/<name>.wav`).
- Helpers: `sfxUrl(id)` → public path; `newSfxInstance(sound, at)` → a placed
  instance object (below).

### 3. Data model (`app/page.js`)

`sfx`: array of **placed instances**:
`{ id, name, at, volume, src }` where `src` is either `{ kind:"lib", file }`
(bundled path) or `{ kind:"upload", mediaId }` (blob in the media store). `at` =
seconds, `volume` = 0..1 (default 0.8). A resolved `url` (public path, or an
objectURL created from the media blob) is derived at runtime for preview/export.

Setters (plain state, mirroring the per-clip maps):
`addSfx(sound, at)`, `moveSfx(id, at)`, `setSfxVolume(id, v)`, `removeSfx(id)`,
and `uploadSfx(file)` (→ `putMedia`, add an `upload` instance to the project
library). Persisted in the project doc under `sfx`; uploaded blobs persist via the
existing media sync (their `mediaId`s are added to the project's wanted-media set).

### 4. Timeline FX track (`components/Timeline.js`)

- New gutter tag **"FX"** and a lane `.tl__lane--fx` under the audio waveform.
- One marker per instance at `left: pct(sfx.at)`; label = sound name.
- **Click the lane** (empty spot) → `onSfxAdd(at)` (drops the tab-selected sound).
- **Drag a marker** → `onSfxMove(id, at)` (reuses the pointer-drag pattern; snaps
  to clip boundaries like the trim handle).
- **Click a marker** → `onSfxOpen(id)` (opens the edit popover).
- New props: `sfx`, `onSfxAdd`, `onSfxMove`, `onSfxOpen`; `rowMin`/`pct` reused so
  the lane stays aligned with the ruler/clips.

### 5. Audio tab (`components/panels/AudioPanel.js`, new)

- Lists the bundled library + the project's uploaded sounds; each row has a
  **preview ▶** (Web Audio one-shot) and selects the sound (highlighted).
- **Upload** button (.mp3/.wav) → `uploadSfx`.
- A short hint: "Select a sound, then click the FX track to place it."
- Selected sound id is local panel state lifted to the editor (so the timeline
  knows what to drop). Added as the 5th tab in `Editor`'s `LeftPanel` tabs array.
- Also shows a small **edit popover** target when a marker is opened: volume
  slider + remove (rendered in the editor near the timeline, or as a small modal).

### 6. Preview scheduler (`lib/sfxScheduler.js` + wiring in `Editor.js`)

A tiny module owning one `AudioContext`:
- `loadBuffer(url)` → decodes + caches an `AudioBuffer`.
- Driven from the editor's existing playback rAF loop: track `prevTime`; each
  frame, for every instance with `prevTime < at ≤ time` while **playing**, start a
  buffer source (gain = volume) and keep it in an active set.
- On pause / seek / scrub-start, stop and clear all active sources.
- A `preview(url, volume)` one-shot for the Audio-tab ▶ buttons.
- Resume the `AudioContext` on the first user gesture (play), like browsers require.

### 7. Export mixing (`lib/webcodecsRender.js`)

- Accept `sfx` in `spec` (each: `{ url, at, volume }` — page.js resolves `url` from
  lib path or media blob objectURL before calling).
- In `prepareClipMixes` (or a sibling `prepareSfxMixes`), decode each SFX via the
  existing tiny `OfflineAudioContext` (`dctx.decodeAudioData`), place the whole
  buffer at `Math.floor(at * mixRate)`, push `{ chans, at, vol }` into the same
  `clipMixes` list. `pumpAudioTo` mixes them unchanged. `wantAudio` must also be
  true when only SFX exist (extend the condition).

### 8. Editor + page wiring

`Editor` gains: `sfx`, the setters, the selected-library-sound state (local),
and passes the FX-track props to `Timeline`, the Audio tab to `LeftPanel`, and the
scheduler hooks into its playback effects. `page.js` threads `sfx` + setters into
`Editor` and both render specs (with resolved `url`s), plus reset/persist/restore
and the media-wanted set for uploads.

## Out of scope

Per-effect fade in/out, waveform display on markers, trimming an SFX, pitch/speed,
Pixabay live search (later), and the ffmpeg render path (canvas/WebCodecs export
only — SFX won't appear in the disabled ffmpeg path).

## Success criteria

- Audio tab lists bundled + uploaded sounds with working ▶ previews; upload works.
- Selecting a sound + clicking the FX lane places a marker; markers drag to move;
  clicking a marker edits volume / removes it.
- SFX play at the right time in the **preview** (correct on play/pause/seek/scrub)
  and are **mixed into the exported MP4** at the same times/volumes.
- `sfx` persist per project; uploaded files survive reload (media store).
- No regression to voiceover / per-clip audio / render. `vitest` green; dev +
  production build compile clean.
