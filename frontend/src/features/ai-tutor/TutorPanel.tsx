import { useEffect, useRef, useState } from "react";
import { useLabStore } from "../../store/labStore";
import { EXAMPLE_QUESTIONS, relatedConcepts, TOOL_LABEL, warningBadges } from "./tutorLogic";
import { askTutor, type TutorEntry, useTutorStore } from "./useTutor";

function Entry({ entry }: { entry: TutorEntry }) {
  const r = entry.response;
  const model = useLabStore((s) => s.model);
  const partName = entry.selectedPart ? model?.parts.find((p) => p.part_id === entry.selectedPart)?.name : null;
  return (
    <li style={{ display: "grid", gap: 4 }} data-testid="tutor-entry">
      <div style={{ fontSize: 12, color: "#8b949e" }}>
        🙋 {entry.question}
        {partName && <span> · 선택: {partName}</span>}
      </div>
      {!r && !entry.error && <div style={{ fontSize: 13 }}>생각하는 중…</div>}
      {entry.error && (
        <div role="alert" style={{ color: "#f85149", fontSize: 12 }}>
          {entry.error}
        </div>
      )}
      {r && (
        <>
          <div style={{ fontSize: 13, lineHeight: 1.6 }} data-testid="tutor-answer">
            🤖 {r.answer}
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {warningBadges(r).map((b) => (
              <span
                key={b.text}
                data-testid="tutor-warning"
                style={{
                  fontSize: 11,
                  padding: "1px 6px",
                  borderRadius: 10,
                  border: `1px solid ${b.level === "warn" ? "#d29922" : "#30363d"}`,
                  color: b.level === "warn" ? "#d29922" : "#8b949e",
                }}
              >
                {b.text}
              </span>
            ))}
            {relatedConcepts(r.used_tools).map((t) => (
              <span
                key={t}
                data-testid="tutor-concept"
                style={{ fontSize: 11, padding: "1px 6px", borderRadius: 10, background: "#1f6feb33", color: "#a5d6ff" }}
              >
                #{t}
              </span>
            ))}
          </div>
          <details>
            <summary style={{ fontSize: 11, color: "#8b949e", cursor: "pointer" }} data-testid="tool-summary">
              도구 호출 {r.used_tools.length}회 · {r.provider}
              {r.degraded ? "(폴백)" : ""} · {(r.latency_ms / 1000).toFixed(1)}초
            </summary>
            <ol style={{ margin: "4px 0", paddingLeft: 18, fontSize: 11 }}>
              {r.used_tools.map((u, i) => (
                <li key={i}>
                  <strong>{TOOL_LABEL[u.name] ?? u.name}</strong> <code>{u.name}</code>
                  <code style={{ color: "#8b949e" }}>({JSON.stringify(u.arguments)})</code>
                  <pre
                    style={{
                      margin: "2px 0 6px",
                      maxHeight: 120,
                      overflow: "auto",
                      background: "#0d1117",
                      padding: 6,
                      borderRadius: 4,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {JSON.stringify(u.result, null, 1)}
                  </pre>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </li>
  );
}

export function TutorPanel() {
  const [text, setText] = useState("");
  const entries = useTutorStore((s) => s.entries);
  const busy = useTutorStore((s) => s.busy);
  const model = useLabStore((s) => s.model);
  const selectedId = useLabStore((s) => s.selectedPartId);
  const selected = model?.parts.find((p) => p.part_id === selectedId);
  const listEnd = useRef<HTMLLIElement>(null);

  useEffect(() => {
    // 최신 브라우저는 scrollIntoView가 Promise를 돌려주므로 effect 반환값으로 넘기지 않는다
    void listEnd.current?.scrollIntoView({ block: "nearest" });
  }, [entries]);

  const send = (q: string) => {
    void askTutor(q);
    setText("");
  };

  return (
    <div style={{ display: "grid", gap: 8 }} data-testid="tutor-panel">
      <strong>AI 튜터</strong>
      <div style={{ fontSize: 12 }}>
        현재 부품:{" "}
        {selected ? (
          <span data-testid="selected-chip" style={{ padding: "1px 8px", borderRadius: 10, background: "#21262d" }}>
            {selected.name}{" "}
            <button
              type="button"
              aria-label="선택 해제"
              onClick={() => useLabStore.getState().setSelected(null)}
              style={{ border: 0, padding: 0, background: "none" }}
            >
              ✕
            </button>
          </span>
        ) : (
          <span style={{ color: "#8b949e" }}>없음 (3D에서 부품을 클릭하세요)</span>
        )}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10, maxHeight: 280, overflowY: "auto" }}>
        {entries.map((e) => (
          <Entry key={e.id} entry={e} />
        ))}
        <li ref={listEnd} />
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        style={{ display: "flex", gap: 6 }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="부품, 조립, 작동에 대해 물어보세요"
          maxLength={500}
          style={{ flex: 1, minWidth: 0 }}
          data-testid="tutor-input"
        />
        <button type="submit" disabled={busy || !text.trim()} data-testid="tutor-send">
          {busy ? "…" : "질문"}
        </button>
      </form>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {EXAMPLE_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => send(q)}
            style={{ fontSize: 11 }}
            data-testid="tutor-example"
          >
            {q}
          </button>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "#8b949e" }}>
        튜터는 실제 부품 데이터와 조립 상태를 도구로 조회해 답합니다. 수치는 도구 결과에서만 인용합니다.
      </p>
    </div>
  );
}
