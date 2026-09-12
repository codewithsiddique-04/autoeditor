// Dependency-free synthesizer for the bundled CC0 sound-effects pack.
// Authored by us => CC0. Writes mono 44.1kHz 16-bit PCM WAVs to public/sfx/.
// Re-run: `node scripts/gen-sfx.mjs`.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SR = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sfx");

const noise = () => Math.random() * 2 - 1;
// Exponential decay envelope over t seconds of a `len`-sample buffer at index i.
const expEnv = (i, len, tau) => Math.exp(-(i / SR) / tau);
// Attack-then-decay "bell" envelope (0..1).
function bell(i, len, attack, tau) {
  const t = i / SR;
  const a = attack > 0 ? Math.min(1, t / attack) : 1;
  const d = Math.exp(-(Math.max(0, t - attack)) / tau);
  return a * d;
}
// One-pole low-pass with coefficient a in (0,1]; higher a = brighter.
function lowpass(buf, a) {
  let y = 0;
  for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y; }
  return buf;
}

function normalize(buf, peak = 0.9) {
  let m = 0;
  for (const v of buf) m = Math.max(m, Math.abs(v));
  if (m > 0) { const g = peak / m; for (let i = 0; i < buf.length; i++) buf[i] *= g; }
  return buf;
}

function seconds(s) { return Math.max(1, Math.round(s * SR)); }

// ---- individual effects ----
function whoosh(dur = 0.55, bright = 0.05) {
  const n = seconds(dur), b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = noise();
  lowpass(b, bright); // smooth the noise into "air"
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const env = Math.sin(Math.PI * p) ** 1.5; // swell in and out
    b[i] *= env;
  }
  return b;
}
function pop(dur = 0.12) {
  const n = seconds(dur), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 700 - 300 * (i / n); // slight downward chirp
    b[i] = Math.sin(2 * Math.PI * f * t) * expEnv(i, n, 0.03);
  }
  b[0] += 0.5; b[1] += 0.3; // tiny transient click
  return b;
}
function ding(dur = 0.7) {
  const n = seconds(dur), b = new Float32Array(n);
  const parts = [[1, 1], [2.01, 0.5], [3.02, 0.28], [4.5, 0.14]];
  const f0 = 880;
  for (let i = 0; i < n; i++) {
    const t = i / SR; let s = 0;
    for (const [mult, amp] of parts) s += amp * Math.sin(2 * Math.PI * f0 * mult * t);
    b[i] = s * bell(i, n, 0.002, 0.28);
  }
  return b;
}
function click(dur = 0.02) {
  const n = seconds(dur), b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = noise() * expEnv(i, n, 0.004);
  return lowpass(b, 0.5);
}
function boom(dur = 0.8) {
  const n = seconds(dur), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 90 - 45 * Math.min(1, t / 0.25); // pitch drop
    b[i] = Math.sin(2 * Math.PI * f * t) * expEnv(i, n, 0.3);
    b[i] += noise() * 0.4 * expEnv(i, n, 0.02); // thump attack
  }
  return lowpass(b, 0.2);
}

// ---- WAV writer (mono 16-bit PCM) ----
function toWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

const SOUNDS = {
  whoosh: () => whoosh(0.55, 0.05),
  swoosh: () => whoosh(0.3, 0.12),
  pop: () => pop(),
  ding: () => ding(),
  click: () => click(),
  boom: () => boom(),
};

mkdirSync(OUT, { recursive: true });
for (const [name, gen] of Object.entries(SOUNDS)) {
  const wav = toWav(normalize(gen()));
  writeFileSync(join(OUT, `${name}.wav`), wav);
  console.log(`wrote ${name}.wav (${wav.length} bytes)`);
}
