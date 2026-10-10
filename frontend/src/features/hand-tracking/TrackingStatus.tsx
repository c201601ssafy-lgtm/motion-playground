import { useTrackingStore } from "../../store/trackingStore";
import type { Finger } from "./types";

const FINGER_LABEL: Record<Finger, string> = {
  thumb: "엄지",
  index: "검지",
  middle: "중지",
  ring: "약지",
  pinky: "소지",
};

const STATUS_LABEL = {
  idle: "대기",
  loading: "모델 불러오는 중…",
  running: "추적 중",
  error: "오류",
} as const;

export function TrackingStatus() {
  const t = useTrackingStore();
  return (
    <div data-testid="tracking-status" style={{ display: "grid", gap: 4, fontSize: 12 }}>
      <div>
        손 추적: <strong data-testid="tracker-status">{STATUS_LABEL[t.trackerStatus]}</strong>
        {t.delegate && ` (${t.delegate})`} · <span data-testid="tracker-fps">{t.fps}</span> fps
      </div>
      {t.trackerError && <div style={{ color: "#f85149" }}>{t.trackerError}</div>}
      {t.trackerStatus === "running" && (
        <div data-testid="hand-detected">
          {t.handDetected
            ? `${t.handedness === "left" ? "왼손" : "오른손"} 감지 (${Math.round(t.confidence * 100)}%) · 집기 거리 ${t.pinchDistance?.toFixed(2)}`
            : "손이 보이지 않습니다"}
        </div>
      )}
      {t.fingerStates && t.handDetected && (
        <div>
          {(Object.keys(FINGER_LABEL) as Finger[]).map((f) => (
            <span key={f} style={{ marginRight: 6, opacity: t.fingerStates![f] ? 1 : 0.35 }}>
              {FINGER_LABEL[f]}
            </span>
          ))}
        </div>
      )}
      <label style={{ color: "#8b949e" }}>
        <input
          type="checkbox"
          checked={t.showOverlay}
          onChange={(e) => t.set({ showOverlay: e.target.checked })}
        />{" "}
        랜드마크 표시
      </label>
    </div>
  );
}
