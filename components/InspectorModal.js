import { useCallback, useEffect, useRef, useState } from "react";
import { tc } from "../lib/format";
import EffectsPanel from "./panels/EffectsPanel";

export default function InspectorModal({
  inspect, onClose,
  clips, imageEls, imageClips, imageCount,
  videoInfoByName, volumeByName, setVolume,
  trimByName, setTrim, fitByName, setFit,
  motionByName, setMotion,
  effectByName = {}, setClipEffect, removeClipEffect,
  replaceImage, removeImage,
  coarse,
}) {
  const replaceInputRef = useRef(null);
  const modalVideoRef = useRef(null);
  const [pendFile, setPendFile] = useState(null);
  const [pendUrl, setPendUrl] = useState(null);

  const clearPend = useCallback(() => {
    setPendUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
    setPendFile(null);
  }, []);
  const close = useCallback(() => { clearPend(); onClose(); }, [clearPend, onClose]);

  const onPickReplacement = useCallback((e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !(file.type.startsWith("image/") || file.type.startsWith("video/"))) return;
    setPendFile(file);
    setPendUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(file); });
  }, []);
  const applyReplacement = useCallback(() => {
    if (inspect && pendFile && replaceImage) replaceImage(inspect, pendFile);
    close();
  }, [inspect, pendFile, replaceImage, close]);
  const removeInspected = useCallback(() => {
    if (inspect && removeImage) removeImage(inspect);
    close();
  }, [inspect, removeImage, close]);

  useEffect(() => {
    if (!inspect) return;
    const onEsc = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [inspect, close]);

  if (!inspect) return null;

  const insClip = clips.find((c) => c.name === inspect);
  const el = imageEls[inspect];
  const num = insClip ? imageClips.indexOf(insClip) + 1 : 0;
  const curUrl = pendUrl || (el && el.url);
  const pendIsVid = !!(pendFile && pendFile.type && pendFile.type.startsWith("video/"));
  const isVid = !!(el && el.isVideo) && !pendUrl;
  const vinfo = videoInfoByName[inspect] || {};
  const vol = volumeByName[inspect] == null ? 0.5 : volumeByName[inspect];
  const inPt = trimByName[inspect] || 0;
  const kind = isVid ? "Video" : "Image";
  const slotDur = (insClip && insClip.duration) || 0;
  const vdur = vinfo.duration || 0;
  const longer = !!(vdur && insClip && vdur > slotDur + 0.05);
  const shorter = !!(vdur && insClip && vdur < slotDur - 0.05);
  const diff = longer || shorter;
  // Default by length: longer clip trims (1x), shorter fills the slot (fit/slow).
  const fitMode = fitByName[inspect] || (longer ? "trim" : "fit");
  const speed = (diff && slotDur > 0) ? (vdur / slotDur) : 1;
  const clipFx = effectByName[inspect];   // { id, intensity } | undefined
  const clipFxOn = !!clipFx;

  return (
    <>
      <input
        ref={replaceInputRef} type="file" accept={coarse ? undefined : "image/*,video/*"} hidden
        onChange={onPickReplacement}
      />
      <div className="modal" role="dialog" aria-modal="true" onClick={close}>
        <div className="modal__card" onClick={(e) => e.stopPropagation()}>
          <div className="modal__head">
            <span className="modal__title">
              {num ? `${kind} ${num} of ${imageCount}` : kind}
              {insClip && <span className="modal__at"> · {tc(insClip.start)}</span>}
            </span>
            <button className="modal__x" onClick={close} aria-label="Close">✕</button>
          </div>

          <div className="modal__stage">
            {pendUrl ? (
              // A chosen-but-not-applied replacement: a video needs a <video>,
              // not an <img> (an <img> with a video URL just shows black).
              pendIsVid
                ? <video src={pendUrl} className="modal__stagevid" controls muted playsInline preload="metadata" />
                : <img src={pendUrl} alt="" />
            ) : isVid && vinfo.url ? (
              <video
                ref={modalVideoRef} src={vinfo.url} className="modal__stagevid"
                controls muted playsInline preload="metadata"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  try { v.currentTime = inPt; } catch { /* ignore */ }
                  v.playbackRate = (diff && fitMode === "fit") ? Math.min(16, Math.max(0.0625, speed)) : 1;
                }}
              />
            ) : (curUrl && <img src={curUrl} alt="" />)}
            {pendUrl && <span className="modal__flag">New — not applied yet</span>}
          </div>
          <div className="modal__file">
            {pendFile ? pendFile.name : (el && el.fileName) || ""}
          </div>

          {insClip && !insClip.gap && (
            <div className="modal__motion">
              <span className="modal__motion-label">Motion (Ken Burns zoom)</span>
              <div className="seg">
                {[["none", "None"], ["zoomin", "Zoom in"], ["zoomout", "Zoom out"]].map(([id, lbl]) => (
                  <button
                    key={id}
                    type="button"
                    className={((motionByName && motionByName[inspect]) || "none") === id ? "is-on" : ""}
                    onClick={() => setMotion && setMotion(inspect, id)}
                  >{lbl}</button>
                ))}
              </div>
            </div>
          )}

          {insClip && !insClip.gap && (
            <div className="modal__motion">
              <div className="cap-bar" style={{ justifyContent: "space-between", ...(clipFxOn ? {} : { borderBottom: "none", paddingBottom: 0, marginBottom: 0 }) }}>
                <span className="modal__motion-label" style={{ marginBottom: 0 }}>
                  Effect — overrides the video effect
                </span>
                <button
                  type="button"
                  className={`cap-switch ${clipFxOn ? "is-on" : ""}`}
                  onClick={() => (clipFxOn ? removeClipEffect && removeClipEffect(inspect) : setClipEffect && setClipEffect(inspect, {}))}
                  aria-pressed={clipFxOn}
                >
                  <span className="cap-switch__box" />
                  {clipFxOn ? "On" : "Off"}
                </button>
              </div>
              {clipFxOn && (
                <EffectsPanel
                  bare
                  effectId={clipFx.id}
                  setEffectId={(id) => setClipEffect(inspect, { id })}
                  effectIntensity={clipFx.intensity}
                  setEffectIntensity={(v) => setClipEffect(inspect, { intensity: v })}
                />
              )}
            </div>
          )}

          {insClip && !insClip.gap && isVid && (
            <div className="modal__vid">
              {diff && (
                <div className="modal__fit">
                  <span className="modal__motion-label">
                    {longer ? "Clip is longer than its slot" : "Clip is shorter than its slot"} · {vinfo.duration.toFixed(1)}s clip, {insClip.duration.toFixed(1)}s slot
                  </span>
                  <div className="seg">
                    <button
                      type="button" className={fitMode === "fit" ? "is-on" : ""}
                      onClick={() => setFit && setFit(inspect, "fit")}
                    >Fit to slot</button>
                    <button
                      type="button" className={fitMode === "trim" ? "is-on" : ""}
                      onClick={() => setFit && setFit(inspect, "trim")}
                    >Trim (1×)</button>
                  </div>
                  {fitMode === "fit"
                    ? <span className="modal__hint">{longer
                      ? `Whole clip fast-forwarded at ${speed.toFixed(1)}× to fit the slot.`
                      : `Whole clip slowed to ${speed.toFixed(2)}× to fill the slot.`}</span>
                    : <span className="modal__hint">Plays at 1× — set a start point below;{longer ? " the rest is cut off." : " the last frame then holds to fill the slot."}</span>}
                </div>
              )}
              {(!diff || fitMode === "trim") && (() => {
                const dur = vinfo.duration || 0;
                const remain = Math.max(0, dur - inPt);        // footage left from the start point
                const playLen = Math.min(insClip.duration, remain); // real-time footage shown
                const holdFor = Math.max(0, insClip.duration - remain); // seconds the last frame holds
                return (
                  <div className="modal__trim">
                    <span className="modal__motion-label">Trim — drag the handle to set where the clip starts</span>
                    {/* Video-editor style trim bar: the fill shows the part that plays;
                        dragging the handle scrubs the preview above and sets the start. */}
                    <div className="trimbar">
                      <div
                        className="trimbar__fill"
                        style={{ left: `${dur ? (inPt / dur) * 100 : 0}%`, width: `${dur ? (playLen / dur) * 100 : 0}%` }}
                      />
                      <input
                        className="trimbar__range"
                        type="range" min={0} max={Math.max(0.1, dur)} step={0.05}
                        value={Math.min(inPt, Math.max(0.1, dur))}
                        onChange={(e) => {
                          const val = +e.target.value;
                          if (setTrim) setTrim(inspect, val);
                          if (modalVideoRef.current) { try { modalVideoRef.current.currentTime = val; } catch { /* ignore */ } }
                        }}
                      />
                    </div>
                    <span className="modal__hint">
                      Starts at {inPt.toFixed(1)}s of {dur.toFixed(1)}s · plays {playLen.toFixed(1)}s in a {insClip.duration.toFixed(1)}s slot
                    </span>
                    {holdFor > 0.05 && (
                      <span className="modal__hint modal__hint--warn">
                        Only {remain.toFixed(1)}s of footage left — the last frame holds for {holdFor.toFixed(1)}s to fill the slot.
                      </span>
                    )}
                  </div>
                );
              })()}
              <div className="modal__vol">
                <span className="modal__motion-label">Clip audio volume</span>
                <div className="modal__slider">
                  <input
                    type="range" min={0} max={1} step={0.05} value={vol}
                    onChange={(e) => setVolume && setVolume(inspect, +e.target.value)}
                  />
                  <span className="trdur__val">{Math.round(vol * 100)}%</span>
                </div>
                <span className="modal__hint">Plays under the voiceover. 0% = silent.</span>
              </div>
            </div>
          )}

          {!pendUrl ? (
            <div className="modal__actions">
              <button className="mbtn mbtn--primary" onClick={() => replaceInputRef.current && replaceInputRef.current.click()}>
                Replace {isVid ? "video" : "image"}
              </button>
              <button className="mbtn mbtn--danger" onClick={removeInspected}>Remove from timeline</button>
            </div>
          ) : (
            <div className="modal__actions">
              <button className="mbtn mbtn--primary" onClick={applyReplacement}>Apply replacement</button>
              <button className="mbtn" onClick={() => replaceInputRef.current && replaceInputRef.current.click()}>Choose different</button>
              <button className="mbtn mbtn--ghost" onClick={clearPend}>Cancel</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
