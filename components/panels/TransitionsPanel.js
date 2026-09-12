import { useCallback, useState } from "react";
import { tc } from "../../lib/format";
import {
  TRANSITION_LIST, transitionOf,
  MIN_TRANSITION_DURATION, MAX_TRANSITION_DURATION,
} from "../../lib/transitions";

export default function TransitionsPanel({
  clips, selectedIndex, selectedClip, selectedImageNum,
  currentType, pickType,
  transitionDuration, setTransitionDuration,
  applyTransitionAll, applyTransitionMix,
}) {
  const [mixMode, setMixMode] = useState(false);
  const [mixPicks, setMixPicks] = useState(() => new Set());
  const toggleMix = useCallback((id) => {
    setMixPicks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="panel transitions">
      <div className="transitions__head">
        <div className="transitions__titlerow">
          <span className="panel__h">Transitions</span>
          <button
            type="button"
            className={`cap-switch ${mixMode ? "is-on" : ""}`}
            onClick={() => setMixMode((v) => !v)}
            aria-pressed={mixMode}
            title="Randomly apply a set of transitions across all cuts"
          >
            <span className="cap-switch__box" />
            Random mix
          </button>
        </div>
        <span className="transitions__target">
          {selectedIndex > 0
            ? `Into image ${selectedImageNum || "—"} · ${tc(selectedClip.start)}`
            : selectedIndex === 0
              ? "First image — no incoming transition"
              : "Tap a ◇ cut above to set its transition"}
        </span>
      </div>

      <div className="transitions__chips">
        {TRANSITION_LIST.map((tr) => {
          const on = mixMode ? mixPicks.has(tr.id) : currentType === tr.id;
          return (
            <button
              key={tr.id}
              type="button"
              className={`trchip ${on ? "is-on" : ""}`}
              onClick={() => (mixMode ? toggleMix(tr.id) : pickType(tr.id))}
            >
              <span className="trchip__icon">{tr.icon}</span>{tr.label}
            </button>
          );
        })}
      </div>

      <label className="trdur">
        <span>Duration</span>
        <input
          type="range" min={MIN_TRANSITION_DURATION} max={MAX_TRANSITION_DURATION} step={0.05}
          value={transitionDuration}
          onChange={(e) => setTransitionDuration(+e.target.value)}
        />
        <span className="trdur__val">{transitionDuration.toFixed(2)}s</span>
      </label>

      {!mixMode ? (
        <button
          type="button" className="trall"
          onClick={() => applyTransitionAll(currentType, clips.map((c) => c.name))}
        >
          Apply “{transitionOf(currentType).label}” to all cuts
        </button>
      ) : (
        <div className="trmix-foot">
          <span className="trmix-count">
            {mixPicks.size ? `Picked ${mixPicks.size}` : "None picked"}
          </span>
          <button
            type="button" className="trall trmix-apply"
            disabled={mixPicks.size === 0}
            onClick={() => applyTransitionMix([...mixPicks], clips.map((c) => c.name))}
          >
            Apply random mix to video
          </button>
        </div>
      )}
    </div>
  );
}
