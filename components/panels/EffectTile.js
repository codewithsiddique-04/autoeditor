import { useEffect, useRef } from "react";
import { applyEffect } from "../../lib/effects";
import { drawScene } from "./sampleScene";

const REST_T = 0.5;

// One effect tile: sample scene + the real applyEffect(). Static at rest,
// animated on hover (grain flicker / falling particles).
export default function EffectTile({ fx, on, onClick }) {
  const ref = useRef(null);
  const rafRef = useRef(0);

  const paintAt = (t) => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    drawScene(ctx, W, H);
    applyEffect(ctx, fx.id, 0.85, W, H, t);
  };

  useEffect(() => { paintAt(REST_T); return () => cancelAnimationFrame(rafRef.current); }, [fx.id]);

  const start = () => {
    cancelAnimationFrame(rafRef.current);
    const t0 = performance.now();
    const step = (t) => { paintAt(Math.max(0, t - t0) / 1000); rafRef.current = requestAnimationFrame(step); };
    rafRef.current = requestAnimationFrame(step);
  };
  const stop = () => { cancelAnimationFrame(rafRef.current); paintAt(REST_T); };

  return (
    <button
      type="button"
      className={`trtile ${on ? "is-on" : ""}`}
      onClick={onClick}
      onPointerEnter={start}
      onPointerLeave={stop}
      title={fx.label}
    >
      <canvas ref={ref} width={140} height={140} className="trtile__cv" />
      <span className="trtile__label">{fx.label}</span>
    </button>
  );
}
