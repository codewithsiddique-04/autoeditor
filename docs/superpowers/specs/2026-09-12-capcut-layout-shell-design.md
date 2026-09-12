# CapCut-style Layout Shell — Design (Spec #1)

**Date:** 2026-09-12
**Branch:** `redesign/capcut-layout`
**Status:** Approved for planning

## Context

The autoeditor is a Next.js image-to-voiceover video editor. Today the editor
(`components/Editor.js`, ~960 lines) uses a two-column layout: a `.main` column
(preview + timeline) and a `.side` column (a vertical, scrollable stack of
panels: Export, Transitions, Motion, Scene fades, Captions).

We are redesigning toward a CapCut / "AutoCut Studio"-style layout: effects live
in a **tabbed left panel**, the **preview** sits in the center, **Export** stays
on the right, and the **timeline** runs full-width across the bottom.

This is spec #1 of a larger decomposition. It is the **layout shell only** — a
structural reorganization of existing features into the new arrangement. No new
effects, no render-pipeline changes.

### The larger decomposition (for reference; NOT in this spec)

| # | Piece | Status |
|---|-------|--------|
| **1** | **Layout shell** (this spec) | In progress |
| 2 | Transitions expansion (new Canvas 2D painters) | Future spec |
| 3 | Captions variety (more presets + fonts) | Future spec |
| 4 | Effects tab — Atmosphere/Genre FX (new visual-filter subsystem) | Future spec |
| 5 | Sound effects (new audio subsystem) | Future spec |

### Key architectural facts established during brainstorming

- **The web render has no ffmpeg in it.** The fast (WebCodecs) render
  (`lib/webcodecsRender.js`) draws each transition with the *same* Canvas 2D
  painter the live preview uses (`transitionOf(type).canvas(...)`). The `xfade`
  string on each transition is dead code in the web path (only read by the
  disabled `lib/serverRender.js` ffmpeg path). Consequence for future specs:
  adding a transition/effect = writing a Canvas 2D function; it works in both
  preview and export automatically. *This spec changes none of that.*
- **Theme is "TryAIToday Flow" — silver/gray on near-black**, defined in
  `app/globals.css` (`--bg:#101012`, `--panel:#17171a`, `--accent:#f6f7f9`
  silver, `--line:#34343a`, `--r:12px`, 16px panel radius). The AutoCut/CapCut
  reference images use blue/purple gradients — **those are NOT adopted.** The new
  layout is built in the existing silver-on-black language, reusing existing
  primitives (`.panel`, `.trchip`, `.seg`, `.cap-switch`, `.render`).

## Decisions (from brainstorming)

1. **Interaction model: relocate-only (low risk).** Move the existing *global*
   panels into tabs as-is. Keep the clip **inspector modal** for per-clip edits
   (motion/trim/volume/replace) unchanged. The left panel is NOT made
   clip-contextual in this spec.
2. **Four tabs, Effects stubbed.** Motion / Transitions / Captions / Effects.
   Effects shows a themed "Coming soon" placeholder (spec #4 fills it).
3. **Timeline: full-width bottom**, spanning under all three columns.
4. **Scene fades fold into the Motion tab** as a section.
5. **Split `Editor.js`** into focused components as part of the work.

## Design

### Layout structure

Replace the current `.editor` grid (`grid-template-columns: minmax(0,1fr) 320px`)
with a two-row structure:

```
Row 1 (flex:1):   [ Left tabs ~340px ] [ Preview (1fr) ] [ Export ~320px ]
Row 2 (flex:none): [ ───────────── Timeline: full width ───────────── ]
```

- **Left column (~340px):** a tab strip on top + a scrollable tab body below.
- **Center:** the `.viewer` (canvas) and the transport bar (play, time,
  undo/redo, now-clip chip) — unchanged.
- **Right column (~320px):** the existing Export panel — unchanged.
- **Bottom:** the existing `<Timeline>` component, now full-width.

Implementation: an outer `.editor2` grid with two rows. Row 1 is a
three-column grid/flex; row 2 holds the timeline.

### Responsive (<860px)

Follows the pattern already in `globals.css`: the fixed-viewport shell drops and
the page scrolls. Rows/columns stack vertically in this order: **left tabs →
preview → export → timeline.** The tab strip becomes a horizontally scrollable
row of tabs. Existing `@media (max-width: 860px)` and `640px` timeline rules are
extended to cover the new containers.

### Tabs & content mapping

Local React state in the editor holds the active tab; default = **Motion**.
Tab buttons styled after `.trchip`/`.seg` (silver-on-black; active state mirrors
`.trchip.is-on`).

| Tab | Content (relocated verbatim from today's `.side` panels) |
|-----|-----------------------------------------------------------|
| **Motion** | "Motion — Ken Burns zoom" panel **+** "Scene fades" panel (as a second section) |
| **Transitions** | Transitions panel: chips, duration slider, random-mix toggle, apply-all |
| **Captions** | Captions panel: upload, on/off, style chips, size, font-scale, line-spacing |
| **Effects** | Stub: "✨ Atmosphere & Genre FX — Coming soon" placeholder |

The clip **inspector modal is unchanged** and still opens on clip click.

### Component decomposition

`Editor.js` (~960 lines) is split into focused units. **No prop *contract*
changes** — the same handlers/state from `app/page.js` flow down unchanged.

- **`components/Editor.js`** → thin layout shell: the `.editor2` grid, tab state,
  and the canvas draw / audio playback / keyboard logic it already owns (the
  `draw`, `seek`, `toggle`, video-priming, playback effects stay here since they
  drive the shared `<canvas>` and `<audio>`).
- **`components/LeftPanel.js`** → tab strip + renders the active tab body.
- **`components/panels/MotionPanel.js`** → Ken Burns zoom + Scene fades.
- **`components/panels/TransitionsPanel.js`** → transitions UI.
- **`components/panels/CaptionsPanel.js`** → captions UI.
- **`components/panels/EffectsPanel.js`** → stub placeholder.
- **`components/panels/ExportPanel.js`** → the right-column Export panel.
- **`components/InspectorModal.js`** → the clip inspector modal (~160 lines
  currently inline in `Editor.js`).

Each panel receives exactly the props it needs (a focused subset of the current
`Editor` props). This is the "well-bounded units" improvement: each file has one
clear purpose and can be reasoned about independently.

### Styling

New classes, all built from existing tokens:

- `.editor2` — the two-row grid (replaces `.editor` usage in the editor view).
- `.tabs` — the tab strip (flex row; horizontal scroll on narrow screens).
- `.tab` / `.tab.is-on` — individual tab buttons (mirror `.trchip` states).
- `.tabpanel` — the scrollable tab body (`overflow-y:auto`, min-height 0).
- `.effects-soon` — the stub placeholder card.

Existing panel/control classes (`.panel`, `.trchip`, `.seg`, `.cap-switch`,
`.trdur`, `.render`, etc.) are reused verbatim inside the panels. The old
`.side` / `.main` rules are removed once nothing references them.

## Out of scope (this spec)

- Timeline **zoom / FIT** controls (reference shows them) — future enhancement.
- Player header badges (resolution/fps chip, "clips synchronized") — optional
  polish, not core.
- "Dark Mode" toggle — N/A; the app is single-theme by design.
- All content expansion: transitions (#2), captions (#3), effects (#4),
  sound effects (#5).
- Any change to the render pipeline (`webcodecsRender.js`, `serverRender.js`),
  transitions/captions libraries, or the clip inspector's behavior.

## Success criteria

- Editor renders as: tabbed left panel, center preview, right Export, full-width
  bottom timeline — in the silver-on-black theme.
- All four tabs present; Motion / Transitions / Captions fully functional
  (identical behavior to today); Effects shows the stub.
- Scene fades reachable inside the Motion tab.
- Clip inspector modal still opens and works unchanged.
- Preview playback, transport, undo/redo, rendering, and export all behave
  exactly as before (no functional regression).
- Layout is usable and stacks correctly at phone width (~400px).
- `Editor.js` is decomposed into the components listed above.
