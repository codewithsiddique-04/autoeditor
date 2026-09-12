export default function MotionPanel({
  imageClips,
  motionByName = {},
  motionAmount, setMotionAmount,
  applyMotionAll, applyMotionAlternate,
  fadeIn, setFadeIn, fadeOut, setFadeOut,
}) {
  // Current motion across all images, so the "apply to all" buttons can show
  // which one is active. allSame = that motion when every image shares it, else
  // null (mixed — e.g. per-clip edits from the inspector).
  const motions = imageClips.map((c) => motionByName[c.name] || "none");
  const allSame = motions.length && motions.every((m) => m === motions[0]) ? motions[0] : null;
  const isAlternate = motions.length > 1
    && motions.every((m, i) => (m === "zoomin" || m === "zoomout") && (i === 0 || m !== motions[i - 1]));

  return (
    <>
      <div className="panel">
        <h2 className="panel__h">Motion — Ken Burns zoom</h2>
        <div className="mini-h">Click an image on the timeline to set its zoom. Set the depth, or apply to all here.</div>
        <label className="trdur">
          <span>Zoom depth</span>
          <input type="range" min={0.02} max={0.2} step={0.01} value={motionAmount}
            onChange={(e) => setMotionAmount(+e.target.value)} />
          <span className="trdur__val">{Math.round(motionAmount * 100)}%</span>
        </label>
        <div className="seg" style={{ marginTop: 8 }}>
          <button type="button" className={allSame === "zoomin" ? "is-on" : ""}
            onClick={() => applyMotionAll("zoomin", imageClips.map((c) => c.name))}>Zoom in all</button>
          <button type="button" className={allSame === "zoomout" ? "is-on" : ""}
            onClick={() => applyMotionAll("zoomout", imageClips.map((c) => c.name))}>Zoom out all</button>
        </div>
        <div className="seg" style={{ marginTop: 6 }}>
          <button type="button" className={isAlternate ? "is-on" : ""}
            onClick={() => applyMotionAlternate(imageClips.map((c) => c.name))}>Alternate</button>
          <button type="button" className={allSame === "none" ? "is-on" : ""}
            onClick={() => applyMotionAll("none", imageClips.map((c) => c.name))}>Clear</button>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel__h">Scene fades</h2>
        <div className="mini-h">Fade the opening and ending (video &amp; audio).</div>
        <label className="trdur">
          <span>Fade in</span>
          <input type="range" min={0} max={2} step={0.1} value={fadeIn} onChange={(e) => setFadeIn(+e.target.value)} />
          <span className="trdur__val">{fadeIn > 0 ? `${fadeIn.toFixed(1)}s` : "off"}</span>
        </label>
        <label className="trdur">
          <span>Fade out</span>
          <input type="range" min={0} max={2} step={0.1} value={fadeOut} onChange={(e) => setFadeOut(+e.target.value)} />
          <span className="trdur__val">{fadeOut > 0 ? `${fadeOut.toFixed(1)}s` : "off"}</span>
        </label>
      </div>
    </>
  );
}
