import { useEffect, useRef } from "react";
import { transitionOf } from "../../lib/transitions";

// Two contrasting placeholder frames (A cool, B warm) so every transition's
// motion is legible in the tiny preview. Built once, on the client only.
let SWATCHES = null;
function swatches() {
  if (SWATCHES) return SWATCHES;
  if (typeof document === "undefined") return null;
  const make = (label, c1, c2) => {
    const cv = document.createElement("canvas");
    cv.width = 160; cv.height = 160;
    const ctx = cv.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 160, 160);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 160, 160);
    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.font = "700 68px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, 80, 86);
    return cv;
  };
  SWATCHES = { a: make("A", "#4a5a7a", "#161c2a"), b: make("B", "#7a5a3a", "#241a10") };
  return SWATCHES;
}

const REST_P = 0.5;      // static frame shown at rest
const LOOP_MS = 1100;    // one A→B pass on hover

// One square transition tile: draws a real mini-preview using the SAME painter
// the editor/export use, so it matches the result. Static mid-frame at rest;
// loops the A→B animation while hovered.
export default function TransitionTile({ tr, on, onClick }) {
  const ref = useRef(null);
  const rafRef = useRef(0);

  const paintAt = (p) => {
    const cv = ref.current;
    if (!cv) return;
    const sw = swatches();
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    if (sw) transitionOf(tr.id).canvas(ctx, sw.a, sw.b, p, W, H, 1, 1);
  };

  useEffect(() => { paintAt(REST_P); return () => cancelAnimationFrame(rafRef.current); }, [tr.id]);

  const start = () => {
    cancelAnimationFrame(rafRef.current);
    const t0 = performance.now();
    const step = (t) => {
      const p = ((t - t0) % LOOP_MS) / LOOP_MS;
      paintAt(p);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };
  const stop = () => { cancelAnimationFrame(rafRef.current); paintAt(REST_P); };

  return (
    <button
      type="button"
      className={`trtile ${on ? "is-on" : ""}`}
      onClick={onClick}
      onPointerEnter={start}
      onPointerLeave={stop}
      title={tr.label}
    >
      <canvas ref={ref} width={140} height={140} className="trtile__cv" />
      <span className="trtile__label">{tr.label}</span>
    </button>
  );
}
