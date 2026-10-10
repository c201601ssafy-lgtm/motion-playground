import { useTrackingStore } from "../../store/trackingStore";
import type { FilterName } from "./filters";
import type { GestureType } from "./types";

export const GESTURE_INFO: Record<GestureType, { label: string; icon: string; action: string }> = {
  NONE: { label: "없음", icon: "·", action: "-" },
  OPEN_PALM: { label: "손바닥 펼치기", icon: "✋", action: "모델 회전" },
  PINCH: { label: "집기", icon: "🤏", action: "부품 잡기·이동" },
  FIST: { label: "주먹", icon: "✊", action: "선택 해제" },
};

const FILTERS: { value: FilterName; label: string }[] = [
  { value: "one-euro", label: "One Euro" },
  { value: "ema", label: "EMA" },
  { value: "none", label: "필터 없음" },
];

export function GestureHud() {
  const gesture = useTrackingStore((s) => s.gesture);
  const phase = useTrackingStore((s) => s.gesturePhase);
  const raw = useTrackingStore((s) => s.rawGesture);
  const filter = useTrackingStore((s) => s.filter);
  const set = useTrackingStore((s) => s.set);
  const info = GESTURE_INFO[gesture];

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 28, lineHeight: 1 }} aria-hidden>
          {info.icon}
        </span>
        <div>
          <div>
            <strong data-testid="gesture-label">{info.label}</strong>
            {phase && gesture !== "NONE" && <span style={{ color: "#8b949e" }}> · {phase}</span>}
          </div>
          <div style={{ color: "#8b949e", fontSize: 12 }}>
            {info.action} · 감지 중: <span data-testid="raw-gesture">{GESTURE_INFO[raw].label}</span>
          </div>
        </div>
      </div>
      <label style={{ fontSize: 12, color: "#8b949e" }}>
        좌표 필터{" "}
        <select value={filter} onChange={(e) => set({ filter: e.target.value as FilterName })}>
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
