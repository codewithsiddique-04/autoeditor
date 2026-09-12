// Shared sample scene (mountains + sun) used by the effect and transition tile
// previews. Two neutral black–silver variants give transitions two distinct
// frames to blend between: "dark" and a lighter "silver".
export function drawScene(ctx, W, H, variant = "dark") {
  const P = variant === "silver"
    ? { sky0: "#9a9ba3", sky1: "#d7d9dd", sun: "#ffffff", mtn: "#43434b" } // light silver frame
    : { sky0: "#33333a", sky1: "#7c7d85", sun: "#e7e8ec", mtn: "#161619" }; // dark frame
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, P.sky0); sky.addColorStop(1, P.sky1);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = P.sun;
  ctx.beginPath(); ctx.arc(W * 0.68, H * 0.34, H * 0.13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = P.mtn;
  ctx.beginPath();
  ctx.moveTo(0, H); ctx.lineTo(W * 0.32, H * 0.55); ctx.lineTo(W * 0.55, H * 0.78);
  ctx.lineTo(W * 0.78, H * 0.5); ctx.lineTo(W, H * 0.72); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
}

// A standalone canvas with the scene painted, for use as a transition from/to
// frame. Built lazily on the client and cached per variant.
const CACHE = {};
export function sceneCanvas(variant = "dark", size = 160) {
  if (CACHE[variant]) return CACHE[variant];
  if (typeof document === "undefined" && typeof OffscreenCanvas === "undefined") return null;
  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : document.createElement("canvas");
  cv.width = size; cv.height = size;
  drawScene(cv.getContext("2d"), size, size, variant);
  CACHE[variant] = cv;
  return cv;
}
