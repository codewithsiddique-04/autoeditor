import { EFFECT_LIST } from "../../lib/effects";
import EffectTile from "./EffectTile";

export default function EffectsPanel({ effectId, setEffectId, effectIntensity, setEffectIntensity }) {
  const active = effectId && effectId !== "none";
  return (
    <div className="panel">
      <h2 className="panel__h">Atmosphere &amp; Genre FX</h2>
      <div className="mini-h">One effect applies to the whole video.</div>
      <div className="trgrid">
        {EFFECT_LIST.map((fx) => (
          <EffectTile
            key={fx.id}
            fx={fx}
            on={effectId === fx.id}
            onClick={() => setEffectId(fx.id)}
          />
        ))}
      </div>
      <label className="trdur" style={{ marginTop: 12, opacity: active ? 1 : 0.5 }}>
        <span>Intensity</span>
        <input
          type="range" min={0} max={1} step={0.05} value={effectIntensity}
          disabled={!active}
          onChange={(e) => setEffectIntensity(+e.target.value)}
        />
        <span className="trdur__val">{Math.round(effectIntensity * 100)}%</span>
      </label>
    </div>
  );
}
