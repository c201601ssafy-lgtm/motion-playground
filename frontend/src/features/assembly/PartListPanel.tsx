import { commandBus } from "../commands/commandBus";
import { useLabStore } from "../../store/labStore";

export function PartListPanel() {
  const model = useLabStore((s) => s.model);
  const focus = useLabStore((s) => s.focusPartId);
  const exploded = useLabStore((s) => s.exploded);
  if (!model) return null;
  const parts = [...model.parts].sort((a, b) => a.step - b.step);
  const focused = parts.find((p) => p.part_id === focus);

  const toggle = (id: string) => {
    const s = useLabStore.getState();
    const next = s.focusPartId === id ? null : id;
    s.setFocus(next);
    s.setSelected(next);
  };

  return (
    <div style={{ display: "grid", gap: 6 }} data-testid="part-list">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>부품 {parts.length}개</strong>
        <button type="button" onClick={() => commandBus.publish({ type: "EXPLODE" }, "ui")} data-testid="explode-toggle">
          {exploded ? "접기" : "분해"} (E)
        </button>
      </div>
      <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 2 }}>
        {parts.map((p) => (
          <li key={p.part_id}>
            <button
              type="button"
              onClick={() => toggle(p.part_id)}
              aria-pressed={focus === p.part_id}
              data-part={p.part_id}
              style={{
                width: "100%",
                textAlign: "left",
                background: focus === p.part_id ? "#1f6feb33" : "transparent",
                border: "1px solid " + (focus === p.part_id ? "#1f6feb" : "transparent"),
              }}
            >
              <span style={{ color: "#8b949e", marginRight: 6 }}>{p.step}단계</span>
              {p.name}
            </button>
          </li>
        ))}
      </ol>
      {focused && (
        <div data-testid="part-detail" style={{ fontSize: 12, lineHeight: 1.5 }}>
          <strong>{focused.name}</strong>
          {focused.teeth && <span style={{ color: "#8b949e" }}> · 이빨 {focused.teeth}개</span>}
          <p style={{ margin: "4px 0" }}>{focused.description}</p>
          <p style={{ margin: 0, color: "#8b949e" }}>{focused.function}</p>
        </div>
      )}
      <div style={{ fontSize: 12, color: "#8b949e" }}>
        조립 순서: {model.steps.map((s) => `${s.step}. ${s.title}`).join(" → ")}
      </div>
    </div>
  );
}
