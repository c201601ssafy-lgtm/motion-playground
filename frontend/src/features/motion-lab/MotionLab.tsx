import { useEffect, useRef, useState, type RefObject } from "react";
import { handFrameBus } from "../hand-tracking/frameBus";
import type { HandFrame } from "../hand-tracking/types";
import { RacingView } from "../racing/RacingView";
import type { SteeringState } from "../racing/steering";
import { ArcheryMotion, armObservation, clamp, PotMotion, RunningMotion, type Game } from "./motions";
import { demoFrames } from "./demo";
import { poseBus, usePoseTracking, type PoseFrame } from "./poseTracking";
import styles from "./MotionLab.module.css";

const GAMES: { id: Game; title: string; description: string; input: string }[] = [
  { id: "running", title: "달리기", description: "검지·중지를 번갈아 굽혔다 펴면 캐릭터의 두 다리가 움직입니다. 같은 손가락만 반복하면 발걸음이 늘지 않습니다.", input: "손가락 → 두 다리" },
  { id: "pot", title: "항아리", description: "선택한 팔을 원을 그리듯 움직여 망치 방향을 바꾸고, 팔을 뻗어 길이를 조절합니다. 망치가 바닥·턱에 닿은 상태에서 휘두르면 몸을 밀어 올립니다.", input: "팔 회전·뻗기 → 망치" },
  { id: "archery", title: "양궁", description: "반대 팔을 표적 쪽으로 뻗어 조준합니다. 선택한 손으로 시위를 잡듯 주먹·집기를 유지하며 당기고, 손가락을 펼치면 발사합니다.", input: "조준 팔 + 당기는 팔" },
  { id: "racing", title: "레이싱", description: "두 손을 핸들처럼 기울여 조향합니다. 양손 손가락을 펼치면 브레이크를 밟으면서도 조향할 수 있습니다.", input: "양손 핸들 + 브레이크" },
];

interface View {
  valid: boolean; flex: number[]; steps: number; angle: number; reach: number; power: number;
  shots: number; hits: number; score: number; potX: number; potY: number; contact: boolean;
  arrow: { x: number; y: number; vx: number; vy: number } | null; armed: boolean; message: string;
}
const INITIAL: View = { valid: false, flex: [0, 0], steps: 0, angle: 0, reach: 0, power: 0, shots: 0, hits: 0, score: 0, potX: 320, potY: 400, contact: false, arrow: null, armed: false, message: "테스트 시작을 누르고 카메라에 입력 동작을 보여 주세요" };

export function MotionLab({ videoRef, poseOverlayRef, cameraOn }: {
  videoRef: RefObject<HTMLVideoElement | null>; poseOverlayRef: RefObject<HTMLCanvasElement | null>; cameraOn: boolean;
}) {
  const [game, setGame] = useState<Game>("running"), [demo, setDemo] = useState(false), [active, setActive] = useState(false);
  const [side, setSide] = useState<"left" | "right">("right"), [threshold, setThreshold] = useState(0.55), [gain, setGain] = useState(1);
  const [view, setView] = useState<View>(INITIAL), [events, setEvents] = useState<string[]>([]), [sampleCount, setSampleCount] = useState(0);
  const [generation, setGeneration] = useState(0);
  const poseStatus = usePoseTracking(videoRef, poseOverlayRef, cameraOn && !demo && (game === "pot" || game === "archery"));
  const observations = useRef<{ hands: HandFrame[]; at: number; pose: PoseFrame | null }>({ hands: [], at: -Infinity, pose: null });
  const samples = useRef<object[]>([]), state = useRef<View>({ ...INITIAL }), log = useRef<string[]>([]);
  const running = useRef(new RunningMotion()), pot = useRef(new PotMotion()), archery = useRef(new ArcheryMotion());
  const calibration = useRef(false), startedAt = useRef(0), velocity = useRef({ x: 0, y: 0 });
  const racingState = useRef<SteeringState | null>(null);
  const contactLoggedAt = useRef(-Infinity);
  const config = GAMES.find((g) => g.id === game)!;

  const reset = () => {
    running.current = new RunningMotion(); pot.current = new PotMotion(); archery.current = new ArcheryMotion();
    state.current = { ...INITIAL }; velocity.current = { x: 0, y: 0 }; samples.current = []; log.current = [];
    calibration.current = false; racingState.current = null; contactLoggedAt.current = -Infinity; setGeneration((n) => n + 1);
    setView({ ...INITIAL }); setEvents([]); setSampleCount(0); startedAt.current = performance.now();
  };
  const changeGame = (next: Game) => { setGame(next); setActive(false); observations.current = { hands: [], at: -Infinity, pose: null }; reset(); };
  useEffect(() => {
    const uh = handFrameBus.subscribe((_frame, timing, hands) => {
      if (!!timing.demo !== demo) return;
      observations.current.hands = hands; observations.current.at = performance.now();
    });
    const up = poseBus.subscribe((frame) => { if (frame && !!frame.demo !== demo) return; observations.current.pose = frame; });
    return () => { uh(); up(); };
  }, [demo]);

  useEffect(() => {
    let handle = 0, last = performance.now(), lastHud = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      if (demo) {
        const sample = demoFrames(game, now - startedAt.current, side);
        observations.current = { hands: sample.hands, at: now, pose: { ...sample.pose, at: now } };
        if (game === "racing") handFrameBus.publish(sample.hands[0] ?? null, { captureAt: now, landmarkMs: 0, demo: true }, sample.hands);
      }
      const obs = observations.current;
      const hands = now - obs.at < 250 ? obs.hands : [];
      const pose = obs.pose && now - obs.pose.at < 250 ? obs.pose : null;
      const hand = hands.find((h) => h.handedness === side) ?? null;
      const aspect = !demo && videoRef.current?.videoHeight ? videoRef.current.videoWidth / videoRef.current.videoHeight : 4 / 3;
      const arm = armObservation(pose, side, aspect), bow = armObservation(pose, side === "right" ? "left" : "right", aspect);
      if (calibration.current && arm) {
        if (game === "pot") pot.current.calibrate(arm.angle);
        else if (game === "archery" && bow) {
          const separation = Math.hypot((bow.wrist.x - arm.wrist.x) * aspect, bow.wrist.y - arm.wrist.y) / bow.width;
          archery.current.calibrate(separation);
        }
        if (game === "pot" || bow) { calibration.current = false; log.current.unshift("현재 자세를 기준으로 보정했습니다"); }
      }
      if (active && game !== "racing") {
        const s = state.current;
        s.valid = false;
        if (game === "running") {
          const r = running.current.update(hand, now, threshold, aspect);
          s.flex = r.flex; s.steps = r.steps; s.valid = !!hand && hand.confidence >= 0.6;
          if (r.step !== null) log.current.unshift(`${r.step === 0 ? "검지 → 왼발" : "중지 → 오른발"} · ${r.steps}걸음`);
          s.message = s.valid ? "검지와 중지를 번갈아 굽혔다 펴 보세요" : "선택한 손의 검지·중지 전체가 보이도록 해 주세요";
        } else if (game === "pot") {
          const r = pot.current.update(arm, gain);
          if (r) {
            s.valid = true; s.angle = r.angle; s.reach = r.reach;
            const len = 65 + r.reach * 110, hx = s.potX + Math.cos(r.angle) * len, hy = s.potY - 35 + Math.sin(r.angle) * len;
            s.contact = hy >= 430 || (hx > 440 && hx < 620 && hy >= 325 && hy < 430);
            if (s.contact && r.impulse > 0.012) {
              velocity.current.y = Math.max(-400, velocity.current.y - r.impulse * 1600);
              velocity.current.x = Math.cos(r.angle) * r.impulse * 650;
              if (now - contactLoggedAt.current > 300) { log.current.unshift("망치 접촉 · 몸 밀어 올리기"); contactLoggedAt.current = now; }
            }
            velocity.current.y += 600 * dt;
            s.potX = clamp(s.potX + velocity.current.x * dt, 65, 735);
            s.potY = clamp(s.potY + velocity.current.y * dt, 80, s.potX > 440 && s.potX < 620 ? 295 : 400);
            if (s.potY >= (s.potX > 440 && s.potX < 620 ? 295 : 400)) velocity.current.y = 0;
          }
          s.message = s.valid ? s.contact ? "접촉 중 · 팔을 휘둘러 몸을 밀어 보세요" : "팔을 돌리고 뻗어 망치를 바닥·턱에 대 보세요" : "어깨·팔꿈치·손목이 모두 보이도록 카메라에서 조금 떨어져 주세요";
        } else {
          const r = archery.current.update(bow, arm, hand, now, threshold * 0.5, aspect);
          s.valid = !!r;
          if (r) {
            s.angle = r.angle; s.power = r.power; s.armed = r.armed;
            if (r.shot) { s.shots++; const speed = 280 + r.shotPower * 480; s.arrow = { x: 250, y: 250, vx: Math.cos(r.angle) * speed, vy: Math.sin(r.angle) * speed }; log.current.unshift(`화살 발사 · 당김 ${Math.round(r.shotPower * 100)}%`); }
          }
          if (s.valid && s.arrow) {
            const a = s.arrow, oldX = a.x, oldY = a.y;
            a.x += a.vx * dt; a.y += a.vy * dt; a.vy += 25 * dt;
            if (oldX < 700 && a.x >= 700) {
              const hitY = oldY + (a.y - oldY) * (700 - oldX) / (a.x - oldX), miss = Math.abs(hitY - 250);
              if (miss < 65) { s.hits++; const score = Math.max(1, Math.round(10 * (1 - miss / 65))); s.score += score; log.current.unshift(`표적 명중 · ${score}점`); }
              else log.current.unshift("표적을 벗어났습니다");
              s.arrow = null;
            } else if (a.x < 0 || a.y < 0 || a.y > 500 || a.x > 800) s.arrow = null;
          }
          s.message = !s.valid ? "양쪽 팔과 당기는 손이 모두 보이도록 해 주세요" : s.armed ? "시위를 당긴 상태 · 손가락을 펼치면 발사" : "선택한 손을 쥐고 뒤로 당겨 보세요";
        }
      }
      if (now - lastHud >= 50) {
        lastHud = now;
        if (active) {
          samples.current.push({ t: Math.round(now - startedAt.current), source: demo ? "synthetic" : "camera", game,
            settings: { side, threshold, gain },
            hands: hands.map((h) => ({ hand: h.handedness, confidence: h.confidence, landmarks: h.landmarks })), pose: pose?.points ?? null,
            output: game === "racing" ? racingState.current : { ...state.current, flex: [...state.current.flex], arrow: state.current.arrow ? { ...state.current.arrow } : null } });
          if (samples.current.length > 1200) samples.current.shift();
        }
        setView({ ...state.current, flex: [...state.current.flex], arrow: state.current.arrow ? { ...state.current.arrow } : null });
        log.current = log.current.slice(0, 12); setEvents([...log.current]); setSampleCount(samples.current.length);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(handle); if (demo) handFrameBus.publish(null, { captureAt: performance.now(), landmarkMs: 0, demo: true }); };
  }, [active, demo, game, gain, side, threshold, videoRef]);

  const exportRecord = () => {
    const data = { version: 1, game, source: demo ? "synthetic" : "camera", settings: { side, threshold, gain }, samples: samples.current, events: log.current };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `motion-${game}-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const length = 65 + view.reach * 110, hx = view.potX + Math.cos(view.angle) * length, hy = view.potY - 35 + Math.sin(view.angle) * length;
  const runnerX = 80 + (view.steps * 18) % 620;

  return <section className={styles.lab} aria-label="게임 모션 실험실">
    <header className={styles.top}><div><span>MOTION PLAYGROUND</span><h2>게임 모션 실험실</h2></div><div className={styles.tabs} role="tablist">{GAMES.map((g) => <button role="tab" aria-selected={game === g.id} key={g.id} onClick={() => changeGame(g.id)}>{g.title}<small>{g.input}</small></button>)}</div></header>
    <div className={styles.toolbar}>
      <button onClick={() => { reset(); setActive(true); }}>테스트 시작 / 초기화</button><button onClick={() => setActive(false)} disabled={!active}>일시정지</button>
      <label><input type="checkbox" checked={demo} onChange={(e) => { setDemo(e.target.checked); observations.current = { hands: [], at: -Infinity, pose: null }; setActive(false); reset(); }} /> 예시 입력 (합성 모션)</label>
      <button onClick={exportRecord} disabled={!sampleCount}>기록 다운로드 ({sampleCount})</button>
      <span className={styles.badge}>{demo ? "예시 모션 · 실제 인식 아님" : cameraOn ? "실제 카메라 입력" : "카메라를 켜거나 예시 입력을 선택하세요"}</span>
    </div>
    {game === "racing" ? <div className={styles.racing}><RacingView key={`race-${demo}-${generation}`} videoRef={videoRef} demo={demo} paused={!active} onSample={(s) => { racingState.current = s; }} /></div> : <div className={styles.content}>
      <div className={styles.preview}><svg viewBox="0 0 800 500" role="img" aria-label={`${config.title} 모션 미리보기`}>
        <defs><pattern id="motion-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#20354f" /></pattern></defs><rect width="800" height="500" fill="#0b1626" /><rect width="800" height="500" fill="url(#motion-grid)" />
        {game === "running" && <><path d="M20 410h760" stroke="#60a5fa" strokeWidth="3" /><g transform={`translate(${runnerX},260)`}><circle cy="-50" r="25" fill="#93c5fd" /><path d="M0-25v65 M0 0l-35 35 M0 0l35 35" fill="none" stroke="#93c5fd" strokeWidth="12" strokeLinecap="round" /><path d={`M0 40L${-25 - view.flex[0]! * 35} 90L${-40 + view.flex[0]! * 60} ${150 - view.flex[0]! * 50}`} fill="none" stroke="#60a5fa" strokeWidth="14" strokeLinecap="round" /><path d={`M0 40L${25 + view.flex[1]! * 35} 90L${40 - view.flex[1]! * 60} ${150 - view.flex[1]! * 50}`} fill="none" stroke="#fbbf24" strokeWidth="14" strokeLinecap="round" /></g><text x="35" y="55" fill="#93c5fd">검지 = 왼발 · 중지 = 오른발</text></>}
        {game === "pot" && <><rect x="0" y="430" width="800" height="70" fill="#334155" /><rect x="440" y="325" width="180" height="105" fill="#475569" /><ellipse cx={view.potX} cy={view.potY} rx="35" ry="30" fill="#b45309" /><circle cx={view.potX} cy={view.potY - 55} r="19" fill="#fdba74" /><path d={`M${view.potX} ${view.potY - 35}L${hx} ${hy}`} stroke="#cbd5e1" strokeWidth="9" /><rect x={hx - 20} y={hy - 9} width="40" height="18" rx="4" fill={view.contact ? "#4ade80" : "#c084fc"} /><text x="35" y="55" fill="#c084fc">팔로 망치를 휘두르고, 뻗어서 바닥을 짚으세요</text></>}
        {game === "archery" && <><path d="M80 450h640" stroke="#475569" /><circle cx="190" cy="185" r="22" fill="#fdba74" /><path d="M190 207v90l-35 145 M190 297l35 145 M190 225l60 25" stroke="#fdba74" strokeWidth="10" fill="none" /><g transform={`translate(250,250) rotate(${view.angle * 180 / Math.PI})`}><path d="M0-65Q70 0 0 65" stroke="#c084fc" strokeWidth="6" fill="none" /><path d={`M0-65L${-view.power * 75} 0L0 65`} fill="none" stroke="#cbd5e1" /><path d="M0 0h80l-12-8 M80 0l-12 8" fill="none" stroke="#fbbf24" strokeWidth="3" /></g><g transform="translate(700,250)">{[65, 48, 30, 12].map((r, i) => <circle key={r} r={r} fill={["#e2e8f0", "#60a5fa", "#f87171", "#fbbf24"][i]} />)}</g>{view.arrow && <path d={`M${view.arrow.x - 30} ${view.arrow.y}h30l-10-6 M${view.arrow.x} ${view.arrow.y}l-10 6`} stroke="#fbbf24" strokeWidth="3" fill="none" />}</>}
      </svg><div className={styles.metrics}>{game === "running" ? <><b>{view.steps} 걸음</b><span>검지 {Math.round(view.flex[0]! * 100)}% · 중지 {Math.round(view.flex[1]! * 100)}%</span></> : game === "pot" ? <><b>높이 {Math.round(400 - view.potY)}</b><span>방향 {Math.round(view.angle * 180 / Math.PI)}° · 뻗기 {Math.round(view.reach * 100)}%</span></> : <><b>{view.shots} 발 · {view.hits} 명중 · {view.score}점</b><span>당김 {Math.round(view.power * 100)}% · {view.armed ? "발사 준비" : "시위 잡기"}</span></>}</div><p role="status" className={styles.message}>{active ? view.message : "테스트 시작을 누르면 입력과 기록이 시작됩니다"}</p></div>
      <aside className={styles.panel}><h3>{config.title} 조작</h3><p>{config.description}</p><label>{game === "archery" ? "시위를 당기는 손" : game === "pot" ? "망치를 움직이는 팔" : "달리기를 조종하는 손"}<select value={side} onChange={(e) => { setSide(e.target.value as "left" | "right"); setActive(false); reset(); }}><option value="right">오른손 / 오른팔</option><option value="left">왼손 / 왼팔</option></select></label>
        <label>{game === "pot" ? "밀어 올리는 힘" : game === "running" ? "손가락 발걸음 기준" : "당기기 시작 기준"}<input type="range" min={game === "pot" ? 0.5 : 0.3} max={game === "pot" ? 2 : 0.8} step="0.05" value={game === "pot" ? gain : threshold} onChange={(e) => game === "pot" ? setGain(Number(e.target.value)) : setThreshold(Number(e.target.value))} /></label>
        {game !== "running" && <><button onClick={() => { calibration.current = true; log.current.unshift("양쪽 어깨와 팔이 보이는 현재 자세에서 보정 대기"); }}>현재 자세로 기준 보정</button><p className={styles.note}>상체 추적: {demo ? "합성 상체 입력" : poseStatus}<br />양쪽 어깨와 사용하는 팔이 모두 화면에 들어오게 해 주세요. 양궁은 시위를 당기기 전 가까운 손 위치에서 보정합니다.</p></>}
        <div className={styles.badge}>{active ? view.valid ? "유효한 모션 입력" : "추적 대기 · 게임 동작 정지" : "테스트 대기"}</div><h4>최근 판정</h4><ol className={styles.logs}>{events.map((e, i) => <li key={i}>{e}</li>)}{!events.length && <li>판정 이벤트가 여기에 표시됩니다.</li>}</ol><p className={styles.note}>최근 약 60초의 관절 좌표·게임 입력·이벤트만 저장합니다. 영상은 저장하지 않습니다. 예시 입력은 인식률 검증에 포함하지 마세요.</p></aside>
    </div>}
  </section>;
}
