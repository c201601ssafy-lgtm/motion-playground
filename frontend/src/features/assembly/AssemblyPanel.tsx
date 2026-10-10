import { useAssemblyStore } from "../../store/assemblyStore";
import { useLabStore } from "../../store/labStore";
import { askWhyWrong } from "../ai-tutor/useTutor";
import { WHY_WRONG_QUESTION } from "../ai-tutor/tutorLogic";
import { commandBus } from "../commands/commandBus";
import { startNewSession } from "./useAssemblyMode";

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span>
          {value}/{max}
        </span>
      </div>
      <div style={{ height: 6, background: "#21262d", borderRadius: 3 }}>
        <div
          style={{
            width: `${max ? (value / max) * 100 : 0}%`,
            height: "100%",
            background: "#3fb950",
            borderRadius: 3,
            transition: "width 300ms",
          }}
        />
      </div>
    </div>
  );
}

export function AssemblyPanel() {
  const model = useLabStore((s) => s.model);
  const guide = useLabStore((s) => s.guide);
  const dragging = useLabStore((s) => s.draggingPartId);
  const { snapshot, error, busy, attempts, errors, startedAt, completedAt, lastResult } = useAssemblyStore();
  const canAskWhy = !!lastResult && !lastResult.is_valid && lastResult.error_type !== "TOO_FAR";
  if (!model) return null;
  const steps = model.steps.length;
  const current = model.steps.find((s) => s.step === snapshot?.current_step);
  const elapsed = startedAt && completedAt ? ((completedAt - startedAt) / 1000).toFixed(1) : null;

  return (
    <div style={{ display: "grid", gap: 8 }} data-testid="assembly-panel">
      <strong>조립 모드</strong>
      {error && (
        <div role="alert" style={{ color: "#f85149", fontSize: 12 }}>
          {error}
        </div>
      )}
      <Bar label="단계" value={snapshot?.completed_steps.length ?? 0} max={steps} />
      <Bar label="부품" value={snapshot?.parts_placed ?? 0} max={snapshot?.parts_total ?? model.parts.length} />
      <div data-testid="current-step" style={{ fontSize: 13 }}>
        {snapshot?.is_complete
          ? "✅ 조립 완료! 작동 모드(4)에서 돌려 보세요."
          : current
            ? `${current.step}단계: ${current.title}`
            : "세션 준비 중…"}
      </div>
      {dragging && guide && (
        <div data-testid="snap-guide" style={{ fontSize: 12, color: guide.inRange ? "#3fb950" : "#8b949e" }}>
          가장 가까운 결합 지점 {guide.slotId} · 거리 {guide.distance.toFixed(2)}
          {guide.inRange ? " (놓으면 판정)" : ""}
        </div>
      )}
      {canAskWhy && (
        <button type="button" onClick={() => askWhyWrong(WHY_WRONG_QUESTION)} data-testid="ask-why">
          🤖 왜 틀렸어? (AI 튜터)
        </button>
      )}
      <div style={{ fontSize: 12, color: "#8b949e" }}>
        시도 {attempts}회 · 오류 {errors}회{elapsed ? ` · 완료 시간 ${elapsed}초` : ""}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" disabled={busy} onClick={() => commandBus.publish({ type: "RESET_STEP" }, "ui")}>
          단계 되돌리기 (R)
        </button>
        <button type="button" disabled={busy} onClick={() => commandBus.publish({ type: "ASSEMBLE_ALL" }, "ui")}>
          자동 조립 (A)
        </button>
        <button type="button" disabled={busy} onClick={() => void startNewSession()} data-testid="new-session">
          처음부터
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "#8b949e" }}>
        부품을 집어 결합 지점 근처에 놓으세요. 잡은 채 마우스 휠 또는 [ ] 키로 부품을 돌릴 수 있습니다.
      </p>
    </div>
  );
}

export function AssemblyToast() {
  const toast = useAssemblyStore((s) => s.toast);
  const mode = useLabStore((s) => s.mode);
  if (!toast || mode !== "assemble") return null;
  const color = toast.kind === "success" ? "#3fb950" : toast.kind === "error" ? "#f85149" : "#d29922";
  return (
    <div
      role="status"
      data-testid="assembly-toast"
      data-kind={toast.kind}
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "min(480px, calc(100% - 24px))",
        padding: "8px 14px",
        background: "#161b22ee",
        border: `1px solid ${color}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 6,
        fontSize: 13,
        pointerEvents: "none",
      }}
    >
      <strong style={{ color }}>{toast.title}</strong> {toast.message}
      {toast.detail && <div style={{ color: "#8b949e", fontSize: 12 }}>{toast.detail}</div>}
    </div>
  );
}
