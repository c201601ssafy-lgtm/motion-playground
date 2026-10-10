import { useCallback, useEffect, useState } from "react";
import { getJson } from "../../services/api";
import { useAssemblyStore } from "../../store/assemblyStore";
import { useLabStore } from "../../store/labStore";
import { LATENCY_STAGES, latency, STAGE_LABEL, type StageStats } from "./latency";

interface EventSummary {
  attempts: number;
  valid: number;
  errors: number;
  too_far: number;
  by_error_type: Record<string, number>;
  resets: number;
  auto_assembled: boolean;
  duration_s: number | null;
}

interface ToolSummary {
  cases: number;
  tool_selection_rate: number | null;
  argument_accuracy: number | null;
  execution_success_rate: number | null;
  ungrounded_answer_rate: number | null;
  fact_match_rate: number | null;
  latency_ms_p50: number | null;
}

interface Reports {
  gesture: {
    source: string;
    clips: number;
    frame_accuracy: number;
    macro_f1: number;
    clip_accuracy: number;
    decision_latency_ms: { p50: number | null; p95: number | null };
    stability: Record<string, { jitter_mean: number | null; false_starts_per_clip: number | null }>;
  } | null;
  tool_calls_mock: { summary: ToolSummary } | null;
  tool_calls_ollama: { summary: ToolSummary } | null;
  tool_calls_ollama_baseline: { summary: ToolSummary } | null;
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "-" : `${Math.round(v * 100)}%`);
const ms = (v: number | null | undefined) =>
  v === null || v === undefined ? "-" : v < 10 ? v.toFixed(1) : v.toFixed(0);

const cell = { padding: "2px 6px", textAlign: "center" as const };

export function ResultsPanel() {
  const sessionId = useAssemblyStore((s) => s.sessionId);
  const offline = useLabStore((s) => s.offline);
  const [lat, setLat] = useState<Record<string, StageStats>>(latency.stats());
  const [events, setEvents] = useState<EventSummary | null>(null);
  const [reports, setReports] = useState<Reports | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLat(latency.stats());
    if (offline) return;
    try {
      setReports(await getJson<Reports>("/reports"));
      if (sessionId) setEvents((await getJson<{ summary: EventSummary }>(`/sessions/${sessionId}/events`)).summary);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId, offline]);

  useEffect(() => {
    void load();
    const id = setInterval(() => setLat(latency.stats()), 1000);
    return () => clearInterval(id);
  }, [load]);

  const exportJson = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { exported_at: new Date().toISOString(), latency: lat, session: { id: sessionId, events }, reports },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `holoforge-results-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const g = reports?.gesture;
  const toolRows: [string, ToolSummary | undefined][] = [
    ["qwen3 (도구 강제 전)", reports?.tool_calls_ollama_baseline?.summary],
    ["qwen3 (도구 강제 후)", reports?.tool_calls_ollama?.summary],
    ["Mock (규칙)", reports?.tool_calls_mock?.summary],
  ];

  return (
    <div style={{ display: "grid", gap: 10, fontSize: 12 }} data-testid="results-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 14 }}>실험 결과</strong>
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => void load()}>
            새로고침
          </button>
          <button type="button" onClick={exportJson} data-testid="export-results">
            JSON 내보내기
          </button>
        </span>
      </div>
      {error && (
        <div role="alert" style={{ color: "#f85149" }}>
          {error}
        </div>
      )}

      <section data-testid="results-latency">
        <strong>시스템 지연 (이 브라우저, 최근 300프레임)</strong>
        <table style={{ borderSpacing: 0 }}>
          <thead>
            <tr style={{ color: "#8b949e" }}>
              <th style={{ textAlign: "left" }}>단계</th>
              <th style={cell}>p50</th>
              <th style={cell}>p95</th>
              <th style={cell}>n</th>
            </tr>
          </thead>
          <tbody>
            {LATENCY_STAGES.map((s) => (
              <tr key={s}>
                <td>{STAGE_LABEL[s]}</td>
                <td style={cell}>{ms(lat[s]?.p50)}</td>
                <td style={cell}>{ms(lat[s]?.p95)}</td>
                <td style={cell}>{lat[s]?.n ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lat.landmark?.n && <div style={{ color: "#8b949e" }}>카메라를 켜고 손을 움직이면 측정됩니다.</div>}
      </section>

      <section data-testid="results-session">
        <strong>조립 세션</strong>
        {events ? (
          <div>
            시도 {events.attempts}회 · 성공 {events.valid} · 오류 {events.errors}
            {events.duration_s !== null && ` · 완료 시간 ${events.duration_s}초`}
            {events.auto_assembled && " · (자동 조립 사용)"}
            {Object.keys(events.by_error_type).length > 0 && (
              <div style={{ color: "#8b949e" }}>
                오류 유형:{" "}
                {Object.entries(events.by_error_type)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(", ")}
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: "#8b949e" }}>조립 모드(3)에서 세션을 시작하면 집계됩니다.</div>
        )}
      </section>

      <section data-testid="results-gesture">
        <strong>제스처 인식 평가</strong>{" "}
        {g && (
          <span style={{ color: "#8b949e" }}>
            ({g.source}, 클립 {g.clips}개)
          </span>
        )}
        {g ? (
          <>
            <div>
              프레임 정확도 {pct(g.frame_accuracy)} · Macro F1 {g.macro_f1.toFixed(2)} · 클립 정확도{" "}
              {pct(g.clip_accuracy)} · 판정 지연 p50 {ms(g.decision_latency_ms.p50)}ms
            </div>
            <table style={{ borderSpacing: 0 }}>
              <thead>
                <tr style={{ color: "#8b949e" }}>
                  <th style={{ textAlign: "left" }}>필터</th>
                  <th style={cell}>위치 흔들림</th>
                  <th style={cell}>클립당 오전환</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(g.stability).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td style={cell}>{v.jitter_mean?.toFixed(4) ?? "-"}</td>
                    <td style={cell}>{v.false_starts_per_clip ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {g.source === "synthetic" && (
              <div style={{ color: "#d29922" }}>
                합성 데이터 결과입니다. 실제 녹화(7: 데이터 녹화)로 다시 측정하세요.
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#8b949e" }}>리포트 없음 — `uv run python scripts/eval_gestures.py`</div>
        )}
      </section>

      <section data-testid="results-tools">
        <strong>AI 도구 호출 평가 (개선 전후)</strong>
        <table style={{ borderSpacing: 0 }}>
          <thead>
            <tr style={{ color: "#8b949e" }}>
              <th style={{ textAlign: "left" }}>설정</th>
              <th style={cell}>도구 선택</th>
              <th style={cell}>인자</th>
              <th style={cell}>미근거 숫자</th>
              <th style={cell}>사실 일치</th>
              <th style={cell}>p50</th>
            </tr>
          </thead>
          <tbody>
            {toolRows.map(([name, s]) => (
              <tr key={name} data-row={name}>
                <td>{name}</td>
                <td style={cell}>{pct(s?.tool_selection_rate)}</td>
                <td style={cell}>{pct(s?.argument_accuracy)}</td>
                <td style={cell}>{pct(s?.ungrounded_answer_rate)}</td>
                <td style={cell}>{pct(s?.fact_match_rate)}</td>
                <td style={cell}>{s?.latency_ms_p50 ? `${(s.latency_ms_p50 / 1000).toFixed(1)}s` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p style={{ margin: 0, color: "#8b949e" }}>자세한 기록: docs/experiments.md · evals/reports/</p>
    </div>
  );
}
