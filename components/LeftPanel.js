import { useState } from "react";

export default function LeftPanel({ tabs }) {
  const [active, setActive] = useState(tabs[0] ? tabs[0].id : null);
  const current = tabs.find((t) => t.id === active) || tabs[0];
  return (
    <div className="leftpanel">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active}
            className={`tab ${t.id === active ? "is-on" : ""}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel">
        {current ? current.node : null}
      </div>
    </div>
  );
}
