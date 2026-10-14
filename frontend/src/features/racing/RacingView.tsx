import { useEffect, useRef, useState, type RefObject } from "react";
import { handFrameBus } from "../hand-tracking/frameBus";
import { useTrackingStore } from "../../store/trackingStore";
import { SteeringController, type SteeringState } from "./steering";
import styles from "./RacingView.module.css";

export function RacingView({ videoRef, demo = false, paused = false, onSample }: { videoRef: RefObject<HTMLVideoElement | null>; demo?: boolean; paused?: boolean; onSample?: (s: SteeringState) => void }) {
  const callback = useRef(onSample); callback.current = onSample;
  const controller = useRef(new SteeringController());
  const [state, setState] = useState(() => controller.current.step(performance.now()));
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const tracker = useTrackingStore((s) => s.trackerStatus);

  useEffect(() => {
    const unsub = handFrameBus.subscribe((_frame, timing, hands) => {
      if (!!timing.demo !== demo) return;
      const video = videoRef.current;
      const aspect = video?.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
      controller.current.observe(hands, performance.now(), aspect);
      setPoints(hands.filter((h) => h.confidence >= 0.6).map((h) => ({ x: 1 - h.landmarks[0]!.x, y: h.landmarks[0]!.y })));
    });
    let handle = 0, lastHud = 0;
    const tick = (now: number) => {
      const next = controller.current.step(now, paused);
      if (now - lastHud >= 50) { setState(next); callback.current?.(next); lastHud = now; }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => { unsub(); cancelAnimationFrame(handle); };
  }, [videoRef, demo, paused]);

  useEffect(() => {
    if (tracker === "idle" || tracker === "error") {
      controller.current.observe([], performance.now());
      setPoints([]);
    }
  }, [tracker]);

  return <section className={styles.layout} aria-label="모션 핸들 테스트">
    <div className={styles.stage}>
      <div className={styles.heading}><span>GESTURE DRIVE</span><h2>손으로 잡는 핸들</h2><p>기울여 조향하고, 손을 펼쳐 브레이크를 밟아 보세요.</p></div>
      <div className={styles.wheelWrap}>
        <svg viewBox="0 0 320 320" className={styles.wheel} style={{ transform: `rotate(${state.angle}deg)` }} role="img" aria-label={`핸들 ${state.angle.toFixed(1)}도`}>
          <circle cx="160" cy="160" r="130" fill="#0d1727" stroke="#22354f" strokeWidth="28" />
          <circle cx="160" cy="160" r="130" fill="none" stroke={state.brake ? "#f87171" : "#60a5fa"} strokeWidth="4" />
          <path d="M160 40v15 M40 160h75 M280 160h-75 M160 205v75" stroke="#526985" strokeWidth="18" strokeLinecap="round" />
          <circle cx="160" cy="160" r="47" fill="#182b43" stroke="#526985" strokeWidth="3" />
          <path d="M146 161l10 10 21-24" fill="none" stroke="#60a5fa" strokeWidth="5" strokeLinecap="round" />
        </svg>
        <span className={styles.angle} data-testid="steering-angle">{state.angle.toFixed(1)}°</span>
      </div>
      <div className={styles.output}>
        <span>왼쪽</span><div className={styles.steeringBar}><i style={{ left: `${50 + state.steering * 48}%` }} /></div><span>오른쪽</span>
      </div>
      <div className={styles.readouts}>
        <div><small>조향 입력</small><strong>{Math.round(state.steering * 100)}%</strong></div>
        <div><small>시뮬레이션 속도</small><strong>{Math.round(state.speed)} <small>km/h</small></strong></div>
        <div data-testid="racing-brake"><small>페달</small><strong style={{ color: state.brake ? "#f87171" : "#4ade80" }}>{state.status === "ready" ? state.brake ? "브레이크" : "자동 가속" : "대기 / 감속"}</strong></div>
      </div>
      <p className={styles.message} role="status">{state.message}</p>
    </div>
    <aside className={styles.panel}>
      <h3>핸들 인식 확인</h3>
      <p>1. 왼쪽 아래에서 카메라를 켭니다.<br />2. 두 손을 가슴 앞에서 핸들처럼 벌립니다.<br />3. <b>중앙 맞추기</b>를 누르고 잠깐 유지합니다.</p>
      <button onClick={() => controller.current.calibrate()} disabled={tracker !== "running" && !demo}>중앙 맞추기 / 다시 보정</button>
      {state.status === "calibrating" && <progress value={state.progress} max={1} aria-label="중앙 보정 진행" />}
      <div className={styles.rules}><b>↔ 조향</b><p>한쪽 손을 올리고 반대쪽을 내려 핸들을 기울립니다. 두 손을 함께 옮겨도 조향은 바뀌지 않습니다.</p><b>✋ 브레이크 + 조향</b><p>양손 손가락을 펼치면 감속합니다. 펼친 상태 그대로 기울이면 감속하면서 조향합니다. 다시 가볍게 쥐면 자동 가속합니다.</p></div>
      <svg viewBox="0 0 280 140" className={styles.preview} role="img" aria-label="인식된 손목 위치">
        <path d="M0 70h280 M140 0v140" stroke="#243650" strokeDasharray="4 5" />
        {state.hands === 2 && points.length === 2 && <line x1={points[0]!.x * 280} y1={points[0]!.y * 140} x2={points[1]!.x * 280} y2={points[1]!.y * 140} stroke="#60a5fa" strokeWidth="3" />}
        {state.hands > 0 && points.map((p, i) => <circle key={i} cx={p.x * 280} cy={p.y * 140} r="7" fill="#60a5fa" />)}
      </svg>
      <div className={styles.metrics}><span>손 인식 {state.hands}/2</span><span>측정 각도 {state.rawAngle.toFixed(1)}°</span></div>
      <p className={styles.note}>중앙 ±5°는 직진 · ±30°는 최대 조향<br />손을 놓치면 자동 감속, 1초 이상 끊기면 정지합니다.<br />속도는 조작 확인을 위한 시뮬레이션 값입니다.</p>
    </aside>
  </section>;
}
