import * as api from "../../services/assemblyApi";
import { useAssemblyStore } from "../../store/assemblyStore";
import { useLabStore } from "../../store/labStore";
import { useOperateStore } from "../../store/operateStore";
import { commandBus } from "../commands/commandBus";
import { directionLabel } from "./mechanismView";

async function demoAssemble() {
  const model = useLabStore.getState().model;
  if (!model) return;
  const asm = useAssemblyStore.getState();
  try {
    const sid = asm.sessionId ?? (await api.createSession(model.meta.model_id)).session_id;
    const snapshot = await api.assembleAll(sid);
    useAssemblyStore.getState().set({ sessionId: sid, snapshot });
  } catch (err) {
    useOperateStore.getState().set({ error: err instanceof Error ? err.message : String(err) });
  }
}

export function OperatePanel() {
  const model = useLabStore((s) => s.model);
  const { inputRpm, mechanism, error, set } = useOperateStore();
  const sessionId = useAssemblyStore((s) => s.sessionId);
  const name = (id: string) => model?.parts.find((p) => p.part_id === id)?.name ?? id;

  return (
    <div style={{ display: "grid", gap: 8 }} data-testid="operate-panel">
      <strong>작동 모드</strong>
      {error && (
        <div role="alert" style={{ color: "#f85149", fontSize: 12 }}>
          {error}
        </div>
      )}
      <label style={{ fontSize: 12 }}>
        입력축 회전 <strong data-testid="input-rpm">{inputRpm}</strong> rpm
        <input
          type="range"
          min={-60}
          max={60}
          step={5}
          value={inputRpm}
          onChange={(e) => set({ inputRpm: Number(e.target.value) })}
          style={{ width: "100%" }}
          data-testid="rpm-slider"
        />
      </label>
      {!sessionId && <div style={{ fontSize: 12, color: "#8b949e" }}>아직 조립 세션이 없습니다.</div>}
      {mechanism && !mechanism.operable && (
        <div data-testid="not-operable" style={{ fontSize: 12 }}>
          <strong style={{ color: "#d29922" }}>작동 불가</strong>
          <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
            {mechanism.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {mechanism?.operable && (
        <>
          <div style={{ fontSize: 13 }} data-testid="reduction">
            전체 감속비 <strong>{mechanism.reduction_ratio}:1</strong> · 출력은 입력의 1/{mechanism.reduction_ratio} 속도
          </div>
          <table data-testid="gear-table" style={{ fontSize: 12, borderSpacing: "6px 2px" }}>
            <thead>
              <tr style={{ color: "#8b949e" }}>
                <th style={{ textAlign: "left" }}>기어</th>
                <th>이빨</th>
                <th>속도비</th>
                <th>rpm</th>
                <th>방향(위에서)</th>
              </tr>
            </thead>
            <tbody>
              {mechanism.gears.map((g) => (
                <tr key={g.part_id} data-gear={g.part_id} data-direction={g.direction}>
                  <td>{name(g.part_id)}</td>
                  <td style={{ textAlign: "center" }}>{g.teeth}</td>
                  <td style={{ textAlign: "center" }}>{g.speed_ratio.toFixed(3)}</td>
                  <td style={{ textAlign: "center" }}>{g.rpm.toFixed(1)}</td>
                  <td>{directionLabel(g)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: 0, fontSize: 12, color: "#8b949e" }}>
            맞물린 기어는 서로 반대로 돕니다. 아이들러 덕분에 출력 기어는 입력 기어와 같은 방향으로 돕니다. 주황 점이 힘이
            전달되는 맞물림 지점입니다.
          </p>
        </>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={() => commandBus.publish({ type: "SET_MODE", mode: "assemble" }, "ui")}>
          조립하러 가기 (3)
        </button>
        <button type="button" onClick={() => void demoAssemble()} data-testid="demo-assemble">
          데모: 자동 조립
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "#8b949e" }}>
        이상적인 기구학 계산값입니다. 마찰·백래시·효율 손실은 반영하지 않습니다.
      </p>
    </div>
  );
}
