// Web Audio preview scheduler for placed sound effects. Preview-only: the export
// mixes SFX separately (lib/webcodecsRender). Decodes each URL once, fires a
// buffer when the playhead crosses its time, and stops everything on pause/seek.

let ctx = null;
const buffers = new Map();  // url -> AudioBuffer
const pending = new Map();  // url -> Promise<AudioBuffer|null>
const active = new Set();   // currently-playing sources

function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; ctx = C ? new C() : null; }
  return ctx;
}

// Browsers require a user gesture to start audio; call this from the play click.
export function resumeSfx() {
  const c = ac();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

export async function loadSfx(url) {
  if (!url) return null;
  if (buffers.has(url)) return buffers.get(url);
  if (pending.has(url)) return pending.get(url);
  const c = ac();
  if (!c) return null;
  const p = (async () => {
    try {
      const res = await fetch(url);
      const ab = await res.arrayBuffer();
      const buf = await c.decodeAudioData(ab);
      buffers.set(url, buf);
      return buf;
    } catch (_) { return null; }
    finally { pending.delete(url); }
  })();
  pending.set(url, p);
  return p;
}

export async function preloadSfx(urls) {
  await Promise.all([...new Set((urls || []).filter(Boolean))].map(loadSfx));
}

function playBuffer(buf, volume) {
  const c = ac();
  if (!c || !buf) return null;
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = Math.max(0, Math.min(1, volume == null ? 0.8 : volume));
  src.connect(g); g.connect(c.destination);
  try { src.start(); } catch (_) { return null; }
  return src;
}

// Fire a placed SFX during playback (its buffer must already be preloaded).
export function fireSfx(url, volume) {
  const buf = buffers.get(url);
  if (!buf) return;
  resumeSfx();
  const src = playBuffer(buf, volume);
  if (!src) return;
  active.add(src);
  src.onended = () => active.delete(src);
}

// Cut all playing SFX (on pause / seek / scrub).
export function stopAllSfx() {
  for (const src of active) { try { src.stop(); } catch (_) {} }
  active.clear();
}

// One-shot preview for the Audio-tab ▶ (loads on demand).
export async function previewSfx(url, volume = 0.9) {
  resumeSfx();
  const buf = await loadSfx(url);
  if (buf) playBuffer(buf, volume);
}
