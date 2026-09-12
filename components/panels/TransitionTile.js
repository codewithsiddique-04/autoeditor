import { useEffect, useRef } from "react";
import { transitionOf } from "../../lib/transitions";
import { sceneCanvas } from "./sampleScene";

const REST_P = 0.5;      // static frame shown at rest
const LOOP_MS = 1100;    // one A→B pass on hover

// One square transition tile: draws a real mini-preview using the SAME painter
// the editor/export use, so it matches the result. Blends between two sample
// scenes (day -> sunset) so the motion reads. Static mid-frame at rest; loops
// the A→B animation while hovered.
export default function TransitionTile({ tr, on, onClick }) {
  const ref = useRef(null);
  const rafRef = useRef(0);

  const paintAt = (p) => {
    const cv = ref.current;
    if (!cv) return;
    const from = sceneCanvas("dark"), to = sceneCanvas("silver");
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    const cp = Math.max(0, Math.min(1, p)); // guard painters that use p as a radius/clip
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    if (from && to) transitionOf(tr.id).canvas(ctx, from, to, cp, W, H, 1, 1);
  };

  useEffect(() => { paintAt(REST_P); return () => cancelAnimationFrame(rafRef.current); }, [tr.id]);

  const start = () => {
    cancelAnimationFrame(rafRef.current);
    const t0 = performance.now();
    const step = (t) => {
      const el = Math.max(0, t - t0); // rAF's timestamp can be just before t0
      paintAt((el % LOOP_MS) / LOOP_MS);
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
