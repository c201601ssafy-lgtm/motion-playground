import { useEffect, useRef, useState } from "react";
import { useTrackingStore } from "../../store/trackingStore";
import { GESTURE_INFO } from "../gestures/GestureHud";
import { GESTURE_TYPES, type GestureType } from "../gestures/types";
import { handFrameBus } from "../hand-tracking/frameBus";
import { type GestureRecord, LandmarkRecorder, type Lighting, SUBJECT_ID_PATTERN, toJsonl } from "./recorder";

const LIGHTING: { value: Lighting; label: string }[] = [
  { value: "bright", label: "밝음" },
  { value: "normal", label: "보통" },
  { value: "dim", label: "어두움" },
];

type Phase = { kind: "idle" } | { kind: "countdown"; n: number } | { kind: "recording" };

export function RecordPanel() {
  const [subject, setSubject] = useState("S01");
  const [lighting, setLighting] = useState<Lighting>("normal");
  const [label, setLabel] = useState<GestureType>("OPEN_PALM");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [records, setRecords] = useState<GestureRecord[]>([]);
  const recorder = useRef(new LandmarkRecorder(2000));
  const tracking = useTrackingStore((s) => s.trackerStatus);
  const validSubject = SUBJECT_ID_PATTERN.test(subject);

  useEffect(
    () =>
      handFrameBus.subscribe((frame) => {
        const rec = recorder.current.push(frame, performance.now());
        if (rec) {
          setRecords((r) => [...r, rec]);
          setPhase({ kind: "idle" });
        }
      }),
    [],
  );

  useEffect(() => {
    if (phase.kind !== "countdown") return;
    const id = setTimeout(() => {
      if (phase.n > 1) setPhase({ kind: "countdown", n: phase.n - 1 });
      else {
        recorder.current.start({ subject_id: subject, lighting, label }, performance.now());
        setPhase({ kind: "recording" });
      }
    }, 1000);
    return () => clearTimeout(id);
  }, [phase, subject, lighting, label]);

  const download = () => {
    const blob = new Blob([toJsonl(records)], { type: "application/x-ndjson" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gestures-${subject}-${new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "")}.jsonl`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const counts = GESTURE_TYPES.map((g) => [g, records.filter((r) => r.label === g).length] as const);
  const busy = phase.kind !== "idle";

  return (
    <div style={{ display: "grid", gap: 8 }} data-testid="record-panel">
      <strong>제스처 데이터 녹화</strong>
      <p style={{ margin: 0, color: "#8b949e", fontSize: 12 }}>
        손 랜드마크 좌표만 저장합니다. 영상·이미지는 저장하지 않습니다. 피험자 ID는 이름 대신 익명 코드(S01 등)를 쓰세요.
      </p>
      <label>
        피험자 ID{" "}
        <input value={subject} onChange={(e) => setSubject(e.target.value)} size={8} disabled={busy} />
        {!validSubject && <span style={{ color: "#f85149" }}> 영문·숫자 1~16자</span>}
      </label>
      <label>
        조명{" "}
        <select value={lighting} onChange={(e) => setLighting(e.target.value as Lighting)} disabled={busy}>
          {LIGHTING.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        라벨{" "}
        <select value={label} onChange={(e) => setLabel(e.target.value as GestureType)} disabled={busy}>
          {GESTURE_TYPES.map((g) => (
            <option key={g} value={g}>
              {GESTURE_INFO[g].icon} {g === "NONE" ? "기타/없음" : GESTURE_INFO[g].label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        data-testid="record-start"
        disabled={busy || !validSubject || tracking !== "running"}
        onClick={() => setPhase({ kind: "countdown", n: 3 })}
      >
        {phase.kind === "countdown" ? `${phase.n}…` : phase.kind === "recording" ? "녹화 중 (2초)" : "2초 녹화"}
      </button>
      {tracking !== "running" && <span style={{ color: "#8b949e", fontSize: 12 }}>먼저 카메라를 켜세요.</span>}
      <div style={{ fontSize: 12 }} data-testid="record-count">
        클립 {records.length}개 · {counts.map(([g, n]) => `${g} ${n}`).join(" · ")}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={download} disabled={!records.length} data-testid="record-download">
          JSONL 다운로드
        </button>
        <button type="button" onClick={() => setRecords([])} disabled={!records.length || busy}>
          비우기
        </button>
      </div>
    </div>
  );
}
