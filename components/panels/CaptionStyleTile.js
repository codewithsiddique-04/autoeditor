import { useEffect, useRef } from "react";
import { drawCaption } from "../../lib/captions";

// A square tile previewing a caption style: renders "Aa" via the real
// drawCaption() on a neutral gray backdrop (so white text, boxes, and bars all
// read). Static — caption styles don't animate.
export default function CaptionStyleTile({ st, fontFamily, on, onClick }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#4a4a52"); g.addColorStop(1, "#2a2a30");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    drawCaption(ctx, "Aa", W, H, st.id, Math.round(H * 0.34), 1.16, fontFamily || "CaptionFont", "middle");
  }, [st.id, fontFamily]);

  return (
    <button type="button" className={`captile ${on ? "is-on" : ""}`} onClick={onClick} title={st.label}>
      <canvas ref={ref} width={140} height={140} className="captile__cv" />
      <span className="captile__label">{st.label}</span>
    </button>
  );
}
