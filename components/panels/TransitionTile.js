import { useEffect, useRef } from "react";
import { transitionOf } from "../../lib/transitions";

// A gallery/image glyph, drawn in `color` inside a 160×160 frame.
function drawGalleryIcon(ctx, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = 6; ctx.lineJoin = "round";
  ctx.strokeRect(40, 46, 80, 68);           // photo frame
  ctx.beginPath(); ctx.arc(64, 70, 9, 0, Math.PI * 2); ctx.fill();  // sun
  ctx.beginPath();                           // mountains
  ctx.moveTo(40, 114); ctx.lineTo(70, 84); ctx.lineTo(88, 100);
  ctx.lineTo(102, 88); ctx.lineTo(120, 108); ctx.lineTo(120, 114);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// Two placeholder frames in the theme's black–silver–gray palette. Frame A is
// dark with a silver glyph; frame B is silver with a dark glyph — enough
// contrast to read every transition's motion without leaving the palette.
// Built once, on the client only.
let SWATCHES = null;
function swatches() {
  if (SWATCHES) return SWATCHES;
  if (typeof document === "undefined") return null;
  const make = (c1, c2, icon) => {
    const cv = document.createElement("canvas");
    cv.width = 160; cv.height = 160;
    const ctx = cv.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 160, 160);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 160, 160);
    drawGalleryIcon(ctx, icon);
    return cv;
  };
  SWATCHES = {
    a: make("#26262c", "#101012", "#c9cace"), // dark frame, silver glyph
    b: make("#7a7b83", "#43434b", "#101012"), // silver frame, dark glyph
  };
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
    const cp = Math.max(0, Math.min(1, p)); // guard painters that use p as a radius/clip
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    if (sw) transitionOf(tr.id).canvas(ctx, sw.a, sw.b, cp, W, H, 1, 1);
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
