import { useCallback, useRef } from "react";
import {
  CAPTION_STYLE_LIST, CAPTION_SIZES, captionLineHeightDefault,
} from "../../lib/captions";

export default function CaptionsPanel({
  captionCues, captionsOn, setCaptionsOn,
  captionStyle, setCaptionStyle,
  captionSize, setCaptionSize,
  captionLineHeight, setCaptionLineHeight,
  captionFontScale, setCaptionFontScale,
  captionName, captionError, onCaptionFile,
}) {
  const capInputRef = useRef(null);
  const onPickCaption = useCallback((e) => {
    const file = e.target.files && e.target.files[0];
    if (file && onCaptionFile) onCaptionFile(file);
    e.target.value = "";
  }, [onCaptionFile]);

  return (
    <>
      <div className="panel captions">
        <h2 className="panel__h">Captions</h2>
        {!(captionCues && captionCues.length) ? (
          <div className="cap-empty">
            <button type="button" className="cap-upload" onClick={() => capInputRef.current && capInputRef.current.click()}>
              <span className="cap-upload__i">⤒</span> Upload timestamped script
            </button>
            <p className="cap-hint">
              An <code>.srt</code>, <code>.vtt</code>, or timestamped <code>.txt</code> — inline
              markers like <code>(0:03)</code>, NoteGPT ranges, or <code>[0:03]</code> lines all
              work. Captions sync to the audio and burn into the MP4.
            </p>
            {captionError && <div className="note note--bad">{captionError}</div>}
          </div>
        ) : (
          <>
            <div className="cap-bar">
              <button
                type="button"
                className={`cap-switch ${captionsOn ? "is-on" : ""}`}
                onClick={() => setCaptionsOn(!captionsOn)}
                aria-pressed={captionsOn}
              >
                <span className="cap-switch__box" />
                {captionsOn ? "On" : "Off"}
              </button>
              <span className="cap-meta">
                <span className="cap-meta__name">{captionName || "captions"}</span>
                {captionCues.length} lines ·{" "}
                <button type="button" className="cap-replace" onClick={() => capInputRef.current && capInputRef.current.click()}>replace</button>
              </span>
            </div>

            <div className="cap-body" aria-disabled={!captionsOn}>
              <div className="mini-h">Style</div>
              <div className="transitions__chips">
                {CAPTION_STYLE_LIST.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    className={`trchip ${captionStyle === st.id ? "is-on" : ""}`}
                    onClick={() => setCaptionStyle(st.id)}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              <div className="mini-h" style={{ marginTop: 12 }}>Size</div>
              <div className="seg">
                {[["sm", "Small"], ["md", "Medium"], ["lg", "Large"]].map(([id, lbl]) => (
                  <button
                    key={id}
                    type="button"
                    className={captionFontScale == null && captionSize === id ? "is-on" : ""}
                    onClick={() => { setCaptionSize(id); setCaptionFontScale && setCaptionFontScale(null); }}
                  >{lbl}</button>
                ))}
              </div>

              <div className="mini-h" style={{ marginTop: 12 }}>Font size (fine-tune)</div>
              <label className="trdur">
                <input
                  type="range" min={0.03} max={0.10} step={0.002}
                  value={captionFontScale != null ? captionFontScale : (CAPTION_SIZES[captionSize] || CAPTION_SIZES.md)}
                  onChange={(e) => setCaptionFontScale && setCaptionFontScale(+e.target.value)}
                />
                <span className="trdur__val">
                  {Math.round((captionFontScale != null ? captionFontScale : (CAPTION_SIZES[captionSize] || CAPTION_SIZES.md)) * 1000) / 10}%
                </span>
              </label>
              {captionFontScale != null && (
                <button type="button" className="cap-replace" onClick={() => setCaptionFontScale && setCaptionFontScale(null)}>
                  reset to preset
                </button>
              )}

              <div className="mini-h" style={{ marginTop: 12 }}>Line spacing (2-line captions)</div>
              <label className="trdur">
                <input
                  type="range" min={1.0} max={2.2} step={0.05}
                  value={captionLineHeight != null ? captionLineHeight : captionLineHeightDefault(captionStyle)}
                  onChange={(e) => setCaptionLineHeight && setCaptionLineHeight(+e.target.value)}
                />
                <span className="trdur__val">
                  {(captionLineHeight != null ? captionLineHeight : captionLineHeightDefault(captionStyle)).toFixed(2)}×
                </span>
              </label>
              {captionLineHeight != null && (
                <button type="button" className="cap-replace" onClick={() => setCaptionLineHeight && setCaptionLineHeight(null)}>
                  reset to default
                </button>
              )}
            </div>
            {captionError && <div className="note note--bad">{captionError}</div>}
          </>
        )}
      </div>
      <input
        ref={capInputRef} type="file" accept=".srt,.vtt,.txt,text/plain" hidden
        onChange={onPickCaption}
      />
    </>
  );
}
