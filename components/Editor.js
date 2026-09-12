"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Timeline from "./Timeline";
import { transitionOf } from "../lib/transitions";
import {
  CAPTION_STYLE_LIST, CAPTION_SIZES, captionAt, drawCaption, captionFontPx, captionLineHeightDefault,
} from "../lib/captions";
import { tc, clock } from "../lib/format";
import ExportPanel from "./panels/ExportPanel";
import TransitionsPanel from "./panels/TransitionsPanel";

export default function Editor({
  clips, imageEls, audioUrl, duration, peaks, dims,
  aspect, setAspect, fps, setFps,
  renderQuality = "full", setRenderQuality, renderDims,
  onRender, onCancel, busy, progress, outUrl, error, warnings,
  onWebCodecsTest, onWebCodecsCancel, wcBusy, wcProgress, wcPhase, wcAvailable, serverAvailable, wcEnabled, setWcEnabled,
  replaceImage, removeImage, fillGap, resizeBoundary,
  transitionsByName, transitionDuration, setTransition, applyTransitionAll, applyTransitionMix, setTransitionDuration,
  fadeIn, setFadeIn, fadeOut, setFadeOut,
  motionByName, setMotion, applyMotionAll, applyMotionAlternate, motionAmount, setMotionAmount,
  videoInfoByName = {}, trimByName = {}, setTrim, volumeByName = {}, setVolume,
  fitByName = {}, setFit,
  trimEnd, setTrimEnd, exportDuration,
  undo, redo, canUndo, canRedo,
  captionCues, captionsOn, setCaptionsOn, captionStyle, setCaptionStyle,
  captionSize, setCaptionSize, captionLineHeight, setCaptionLineHeight,
  captionFontScale, setCaptionFontScale,
  captionName, captionError, onCaptionFile,
}) {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const rafRef = useRef(0);
  const fileInputRef = useRef(null);
  const capInputRef = useRef(null);
  const replaceInputRef = useRef(null);
  const pending = useRef(null); // gap-fill target name
  const trimEndRef = useRef(exportDuration);
  const vidRefs = useRef({});     // clip name -> offscreen <video> for live preview
  const drawRef = useRef(null);   // latest draw fn (so video 'seeked' can redraw)
  const timeRef = useRef(0);      // latest playhead time
  const modalVideoRef = useRef(null); // the trim scrubber <video> in the inspector
  useEffect(() => { trimEndRef.current = exportDuration; }, [exportDuration]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds spent in the current render
  const [selectedCut, setSelectedCut] = useState(null); // selected clip name (drives transition)
  const [currentType, setCurrentType] = useState("fade");
  const [inspect, setInspect] = useState(null);   // slot name open in the inspector
  const [dismissedWarn, setDismissedWarn] = useState(() => new Set()); // hidden warning texts
  // On touch devices, accept="image/*"/"video/*" makes Android open Google Photos,
  // which renames files and breaks the timestamp. Dropping accept opens the Files
  // picker instead (keeps 0-04.mp4). onPick* still filter by type, so nothing bad
  // gets through. Same trick as Dropzone.
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    try { setCoarse(window.matchMedia && window.matchMedia("(pointer: coarse)").matches); } catch { /* ignore */ }
  }, []);
  const [pendFile, setPendFile] = useState(null);  // chosen replacement, not yet applied
  const [pendUrl, setPendUrl] = useState(null);

  // Gap "+" → pick a file to fill an empty slot / lead-in.
  const askAdd = useCallback((name) => {
    pending.current = name;
    if (fileInputRef.current) fileInputRef.current.click();
  }, []);

  const onPickFile = useCallback((e) => {
    const file = e.target.files && e.target.files[0];
    if (file && pending.current && fillGap) fillGap(pending.current, file);
    e.target.value = "";
    pending.current = null;
  }, [fillGap]);

  // Clip inspector: click a clip → preview → optionally pick a replacement,
  // preview it, then Apply (or Remove the image).
  const clearPend = useCallback(() => {
    setPendUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
    setPendFile(null);
  }, []);
  const openInspect = useCallback((name) => { clearPend(); setInspect(name); }, [clearPend]);
  const closeInspect = useCallback(() => { clearPend(); setInspect(null); }, [clearPend]);
  const onPickReplacement = useCallback((e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !(file.type.startsWith("image/") || file.type.startsWith("video/"))) return;
    setPendFile(file);
    setPendUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(file); });
  }, []);
  const applyReplacement = useCallback(() => {
    if (inspect && pendFile && replaceImage) replaceImage(inspect, pendFile);
    closeInspect();
  }, [inspect, pendFile, replaceImage, closeInspect]);
  const removeInspected = useCallback(() => {
    if (inspect && removeImage) removeImage(inspect);
    closeInspect();
  }, [inspect, removeImage, closeInspect]);

  useEffect(() => {
    if (!inspect) return;
    const onEsc = (e) => { if (e.key === "Escape") closeInspect(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [inspect, closeInspect]);

  const onPickCaption = useCallback((e) => {
    const file = e.target.files && e.target.files[0];
    if (file && onCaptionFile) onCaptionFile(file);
    e.target.value = "";
  }, [onCaptionFile]);

  // Keep one offscreen <video> per video clip so the preview can draw live frames
  // (not just the poster). Created/torn down as clips come and go.
  useEffect(() => {
    const map = vidRefs.current;
    for (const [name, info] of Object.entries(videoInfoByName)) {
      if (!map[name] && info && info.url) {
        const v = document.createElement("video");
        v.src = info.url; v.muted = true; v.playsInline = true; v.preload = "auto";
        const redraw = () => { if (drawRef.current) drawRef.current(timeRef.current); };
        v.addEventListener("seeked", redraw);
        v.addEventListener("loadeddata", redraw);
        map[name] = v;
      }
    }
    for (const name of Object.keys(map)) {
      if (!videoInfoByName[name]) { try { map[name].pause(); } catch { /* ignore */ } delete map[name]; }
    }
  }, [videoInfoByName]);

  // Where in the source video to show for a clip at playhead t: the trim in-point
  // plus elapsed × speed (fast-forward). Mirrors the render math in page.js.
  const videoParams = useCallback((name, slotDur) => {
    const info = videoInfoByName[name];
    if (!info) return null;
    const dur = info.duration || 0;
    // Default by length: longer-than-slot trims (1x), shorter fills the slot ("fit").
    const mode = fitByName[name] || (dur > slotDur ? "trim" : "fit");
    if (mode === "fit" && slotDur > 0 && dur > 0 && Math.abs(dur - slotDur) > 0.05) return { trimStart: 0, speed: dur / slotDur };
    return { trimStart: trimByName[name] || 0, speed: 1 };
  }, [videoInfoByName, fitByName, trimByName]);

  const draw = useCallback((t) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    let activeVideo = null; // clip name whose video should be playing this frame

    // Per-clip Ken Burns zoom at time tt (gaps never zoom). Progress is clamped so
    // an outgoing image keeps its end-of-clip zoom through the transition.
    const scaleAt = (ci, tt) => {
      const c = clips[ci];
      if (!c || c.gap) return 1;
      const m = (motionByName && motionByName[c.name]) || "none";
      if (m === "none") return 1;
      const lp = Math.min(1, Math.max(0, (tt - c.start) / c.duration));
      return m === "zoomout" ? 1 + motionAmount * (1 - lp) : 1 + motionAmount * lp;
    };

    // Start/keep a clip's offscreen <video> playing in sync with the playhead and
    // mark it active (so it isn't paused). Returns the element to draw, or null if
    // it isn't a ready-to-draw video. Called both while a clip is showing AND
    // during the transition INTO it, so the video is already warm when revealed.
    const primeVideo = (c, tt, wantDraw) => {
      const vinfo = videoInfoByName[c.name];
      if (!vinfo) return null;
      const v = vidRefs.current[c.name];
      const pr = videoParams(c.name, c.duration);
      if (!v || !pr) return null;
      const srcTime = Math.min(vinfo.duration || 0, Math.max(0, pr.trimStart + (tt - c.start) * pr.speed));
      const clipVol = volumeByName[c.name] == null ? 0.5 : volumeByName[c.name];
      v.volume = Math.min(1, Math.max(0, clipVol));
      v.muted = clipVol <= 0;
      v.playbackRate = Math.min(16, Math.max(0.0625, pr.speed));
      if (v.paused) { try { v.currentTime = srcTime; } catch { /* ignore */ } v.play().catch(() => {}); }
      else if (Math.abs(v.currentTime - srcTime) > 0.6) { try { v.currentTime = srcTime; } catch { /* ignore */ } }
      activeVideo = c.name;
      return (wantDraw && v.readyState >= 2 && !v.seeking) ? v : null;
    };

    if (clips.length) {
      let idx = clips.findIndex((c) => t >= c.start && t < c.start + c.duration);
      if (idx === -1) idx = clips.length - 1;
      const clip = clips[idx];
      const type = idx > 0 ? (transitionsByName[clip.name] || "cut") : "cut";
      const tdur = type === "cut" ? 0 : Math.min(transitionDuration, clip.duration);

      if (idx > 0 && tdur > 0 && t < clip.start + tdur) {
        // Inside a transition: blend the previous image into this one, each at
        // its own current zoom so nothing snaps back to normal size.
        const p = Math.min(1, Math.max(0, (t - clip.start) / tdur));
        transitionOf(type).canvas(
          ctx, imageEls[clips[idx - 1].name] || null, imageEls[clip.name] || null, p, W, H,
          scaleAt(idx - 1, t), scaleAt(idx, t)
        );
        ctx.globalAlpha = 1;
        // Warm up the incoming video during the transition so it's already
        // decoding/playing when it takes over — fixes the stall-then-smooth start.
        if (playing) primeVideo(clip, t, false);
      } else {
        // While PLAYING, draw live video frames (kept warm since the transition);
        // paused/scrubbing shows the still poster — seeking a paused, offscreen
        // video flashes black on many (mobile) browsers, so we don't seek it.
        let drawable = imageEls[clip.name];
        if (playing) { const vEl = primeVideo(clip, t, true); if (vEl) drawable = vEl; }
        const dw = (drawable && (drawable.videoWidth || drawable.naturalWidth)) || 0;
        const dh = (drawable && (drawable.videoHeight || drawable.naturalHeight)) || 0;
        if (drawable && dw && dh) {
          const scale = Math.min(W / dw, H / dh) * scaleAt(idx, t);
          const w = dw * scale, h = dh * scale;
          ctx.drawImage(drawable, (W - w) / 2, (H - h) / 2, w, h);
        }
      }
    }

    // Only the clip under the playhead plays; pause every other clip's video.
    for (const [nm, v] of Object.entries(vidRefs.current)) {
      if (nm !== activeVideo && !v.paused) { try { v.pause(); } catch { /* ignore */ } }
    }

    // Captions burn in before the fades, so the fade dims them too.
    if (captionsOn && captionCues && captionCues.length) {
      const txt = captionAt(captionCues, t);
      if (txt) drawCaption(ctx, txt, W, H, captionStyle, captionFontPx(H, captionSize, captionFontScale), captionLineHeight);
    }

    // Scene fades (opening / ending).
    if (fadeIn > 0 && t < fadeIn) {
      ctx.globalAlpha = Math.max(0, 1 - t / fadeIn);
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
    const outStart = exportDuration - fadeOut;
    if (fadeOut > 0 && t > outStart) {
      ctx.globalAlpha = Math.min(1, (t - outStart) / fadeOut);
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
  }, [clips, imageEls, transitionsByName, transitionDuration, motionByName, motionAmount,
      fadeIn, fadeOut, duration, exportDuration, playing, videoInfoByName, videoParams, volumeByName,
      captionsOn, captionCues, captionStyle, captionSize, captionLineHeight, captionFontScale]);

  useEffect(() => { drawRef.current = draw; }, [draw]);
  useEffect(() => { timeRef.current = time; }, [time]);
  useEffect(() => { draw(time); }, [time, draw]);
  useEffect(() => { setTime(0); }, [audioUrl]);

  // Elapsed render timer.
  useEffect(() => {
    if (!busy && !wcBusy) { setElapsed(0); return; }
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed((Date.now() - start) / 1000), 250);
    return () => clearInterval(id);
  }, [busy, wcBusy]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const loop = () => {
      const end = trimEndRef.current;
      if (end > 0 && a.currentTime >= end) {
        a.pause();
        a.currentTime = end;
        setTime(end);
        return;
      }
      setTime(a.currentTime);
      rafRef.current = requestAnimationFrame(loop);
    };
    const onPlay = () => { setPlaying(true); cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(loop); };
    const onStop = () => { setPlaying(false); cancelAnimationFrame(rafRef.current); setTime(a.currentTime); };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onStop);
    a.addEventListener("ended", onStop);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onStop);
      a.removeEventListener("ended", onStop);
      cancelAnimationFrame(rafRef.current);
    };
  }, [audioUrl]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play(); else a.pause();
  }, []);

  // Coalesce rapid scrub seeks: while a seek is still settling (slow for WAV),
  // remember the latest target and apply it on 'seeked', so the drag's release
  // position always wins instead of being dropped mid-seek.
  const pendingSeekRef = useRef(null);
  const seek = useCallback((t) => {
    const a = audioRef.current;
    if (!a) return;
    const c = Math.min(Math.max(t, 0), duration || t || 0);
    setTime(c);
    if (a.seeking) pendingSeekRef.current = c;
    else { pendingSeekRef.current = null; try { a.currentTime = c; } catch (_) {} }
  }, [duration]);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onSeeked = () => {
      const p = pendingSeekRef.current;
      if (p != null) { pendingSeekRef.current = null; if (Math.abs(a.currentTime - p) > 0.02) { try { a.currentTime = p; } catch (_) {} } }
    };
    a.addEventListener("seeked", onSeeked);
    return () => a.removeEventListener("seeked", onSeeked);
  }, [audioUrl]);

  // Scrubbing a *playing* WAV backward doesn't take — the seek fights live
  // playback and the release position is lost (MP3 settles fast enough to hide
  // this). So pause on grab, let the drag seek freely, then resume from the
  // release point once the pointer is up.
  const scrubResumeRef = useRef(false);
  const onScrubStart = useCallback(() => {
    const a = audioRef.current;
    scrubResumeRef.current = !!(a && !a.paused);
    if (a && !a.paused) { try { a.pause(); } catch (_) {} }
  }, []);
  const onScrubEnd = useCallback(() => {
    const a = audioRef.current;
    if (a && scrubResumeRef.current) { scrubResumeRef.current = false; a.play().catch(() => {}); }
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      if (e.code === "Space") { e.preventDefault(); toggle(); }
      else if (e.code === "ArrowRight") { e.preventDefault(); seek(time + (e.shiftKey ? 5 : 1)); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); seek(time - (e.shiftKey ? 5 : 1)); }
      else if (e.key === "Home") { e.preventDefault(); seek(0); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek, time]);

  const active = clips.find((c) => time >= c.start && time < c.start + c.duration) || clips[clips.length - 1];
  const badClips = useMemo(
    () => new Set(clips.filter((c) => c.duration <= 0.0001).map((c) => c.name)),
    [clips]
  );
  const imageClips = useMemo(() => clips.filter((c) => !c.gap), [clips]);
  const imageCount = imageClips.length;
  const gapCount = clips.length - imageCount;
  const activeIndex = active && !active.gap ? imageClips.indexOf(active) + 1 : 0;

  const selectClip = useCallback((name) => {
    setSelectedCut(name);
    setCurrentType(transitionsByName[name] || "cut");
  }, [transitionsByName]);

  const pickType = useCallback((type) => {
    setCurrentType(type);
    if (selectedCut) setTransition(selectedCut, type);
  }, [selectedCut, setTransition]);

  const selectedClip = selectedCut && clips.find((c) => c.name === selectedCut);
  const selectedIndex = selectedClip ? clips.indexOf(selectedClip) : -1;
  const selectedImageNum = selectedClip && !selectedClip.gap ? imageClips.indexOf(selectedClip) + 1 : 0;

  return (
    <section className="editor">
      <div className="main">
        <div className="viewer">
          <div className="viewer__frame">
            <canvas ref={canvasRef} width={dims.width} height={dims.height} className="viewer__canvas" />
          </div>

          <div className="transport">
            <button className="play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
              {playing ? "❚❚" : "►"}
            </button>
            <div className="time">
              <span className="time__now">{tc(time)}</span>
              <span className="time__sep">/</span>
              <span className="time__total">{tc(exportDuration)}</span>
            </div>
            <div className="transport__spacer" />
            <div className="history">
              <button
                className="hbtn" onClick={undo} disabled={!canUndo}
                title="Undo (Ctrl+Z)" aria-label="Undo"
              >↺</button>
              <button
                className="hbtn" onClick={redo} disabled={!canRedo}
                title="Redo (Ctrl+Shift+Z)" aria-label="Redo"
              >↻</button>
            </div>
            {active && (
              <div className="nowclip">
                <span className="nowclip__k">now</span>
                {active.gap ? "empty gap" : `image ${activeIndex} / ${imageCount}`}
              </div>
            )}
          </div>

          <audio ref={audioRef} src={audioUrl} hidden />
        </div>

        {(() => {
          const shown = warnings.filter((w) => !dismissedWarn.has(w));
          if (!shown.length) return null;
          return (
            <div className="notes notes--compact">
              {shown.length > 1 && (
                <button
                  type="button" className="notes__clear"
                  onClick={() => setDismissedWarn(new Set(warnings))}
                >Dismiss all ({shown.length})</button>
              )}
              {shown.map((w) => (
                <div className="note note--dismissable" key={w}>
                  <span>{w}</span>
                  <button
                    type="button" className="note__x" aria-label="Dismiss"
                    onClick={() => setDismissedWarn((prev) => new Set(prev).add(w))}
                  >✕</button>
                </div>
              ))}
            </div>
          );
        })()}

        <Timeline
          clips={clips}
          imageEls={imageEls}
          duration={duration}
          time={time}
          peaks={peaks}
          activeName={active && active.name}
          badClips={badClips}
          transitionsByName={transitionsByName}
          motionByName={motionByName}
          selectedName={selectedCut}
          onSelect={selectClip}
          onSeek={seek}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
          onOpen={openInspect}
          onAdd={askAdd}
          onResizeBoundary={resizeBoundary}
          trimEnd={trimEnd}
          onTrimChange={setTrimEnd}
        />
      </div>

      <aside className="side">
        <ExportPanel
          aspect={aspect} setAspect={setAspect} fps={fps} setFps={setFps}
          renderQuality={renderQuality} setRenderQuality={setRenderQuality} renderDims={renderDims} dims={dims}
          imageCount={imageCount} gapCount={gapCount} exportDuration={exportDuration} duration={duration} elapsed={elapsed}
          wcAvailable={wcAvailable} serverAvailable={serverAvailable} busy={busy} wcBusy={wcBusy}
          wcPhase={wcPhase} wcProgress={wcProgress} progress={progress}
          wcEnabled={wcEnabled} setWcEnabled={setWcEnabled}
          onWebCodecsTest={onWebCodecsTest} onRender={onRender} onWebCodecsCancel={onWebCodecsCancel} onCancel={onCancel}
          outUrl={outUrl} error={error}
        />

        <TransitionsPanel
          clips={clips}
          selectedIndex={selectedIndex} selectedClip={selectedClip} selectedImageNum={selectedImageNum}
          currentType={currentType} pickType={pickType}
          transitionDuration={transitionDuration} setTransitionDuration={setTransitionDuration}
          applyTransitionAll={applyTransitionAll} applyTransitionMix={applyTransitionMix}
        />

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
            <button type="button" onClick={() => applyMotionAll("zoomin", imageClips.map((c) => c.name))}>Zoom in all</button>
            <button type="button" onClick={() => applyMotionAll("zoomout", imageClips.map((c) => c.name))}>Zoom out all</button>
          </div>
          <div className="seg" style={{ marginTop: 6 }}>
            <button type="button" onClick={() => applyMotionAlternate(imageClips.map((c) => c.name))}>Alternate</button>
            <button type="button" onClick={() => applyMotionAll("none", imageClips.map((c) => c.name))}>Clear</button>
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

      </aside>

      <input
        ref={fileInputRef} type="file" accept={coarse ? undefined : "image/*,video/*"} hidden
        onChange={onPickFile}
      />
      <input
        ref={replaceInputRef} type="file" accept={coarse ? undefined : "image/*,video/*"} hidden
        onChange={onPickReplacement}
      />
      <input
        ref={capInputRef} type="file" accept=".srt,.vtt,.txt,text/plain" hidden
        onChange={onPickCaption}
      />

      {inspect && (() => {
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
        return (
          <div className="modal" role="dialog" aria-modal="true" onClick={closeInspect}>
            <div className="modal__card" onClick={(e) => e.stopPropagation()}>
              <div className="modal__head">
                <span className="modal__title">
                  {num ? `${kind} ${num} of ${imageCount}` : kind}
                  {insClip && <span className="modal__at"> · {tc(insClip.start)}</span>}
                </span>
                <button className="modal__x" onClick={closeInspect} aria-label="Close">✕</button>
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
        );
      })()}
    </section>
  );
}
