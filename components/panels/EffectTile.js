import { useEffect, useRef } from "react";
import { applyEffect } from "../../lib/effects";

// Built-in sample scene so grades/grain/vignette/particles all read in the tile.
function drawScene(ctx, W, H) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#6b7482"); sky.addColorStop(1, "#c7ccd2");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#eef0f2";
  ctx.beginPath(); ctx.arc(W * 0.68, H * 0.34, H * 0.13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3a4048";
  ctx.beginPath();
  ctx.moveTo(0, H); ctx.lineTo(W * 0.32, H * 0.55); ctx.lineTo(W * 0.55, H * 0.78);
  ctx.lineTo(W * 0.78, H * 0.5); ctx.lineTo(W, H * 0.72); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
}

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
