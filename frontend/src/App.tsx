import { useEffect, useRef, useState } from "react";
import styles from "./App.module.css";
import { TutorPanel } from "./features/ai-tutor/TutorPanel";
import { useTutorMode } from "./features/ai-tutor/useTutorMode";
import { AssemblyPanel, AssemblyToast } from "./features/assembly/AssemblyPanel";
import { PartListPanel } from "./features/assembly/PartListPanel";
import { useAssemblyMode } from "./features/assembly/useAssemblyMode";
import { useDisassembleMode } from "./features/assembly/useDisassembleMode";
import { CameraPanel } from "./features/camera/CameraPanel";
import { useCamera } from "./features/camera/useCamera";
import { commandBus } from "./features/commands/commandBus";
import { KeyboardCommandSource } from "./features/commands/keyboardSource";
import { MouseCommandSource } from "./features/commands/mouseSource";
import { GestureCommandSource } from "./features/gestures/gestureCommandSource";
import { HAND_IDS } from "./features/gestures/multiHandPipeline";
import { gestureEventBus } from "./features/gestures/gestureEventBus";
import { GestureHud } from "./features/gestures/GestureHud";
import { TwoHandCommandSource } from "./features/gestures/twoHandCommandSource";
import { handFrameBus } from "./features/hand-tracking/frameBus";
import { installDebugApi } from "./features/gestures/simulator";
import { useGesturePipeline } from "./features/gestures/useGesturePipeline";
import { OperatePanel } from "./features/simulation/OperatePanel";
import { useOperateMode } from "./features/simulation/useOperateMode";
import { TrackingStatus } from "./features/hand-tracking/TrackingStatus";
import { useHandTracking } from "./features/hand-tracking/useHandTracking";
import { LatencyPanel } from "./features/metrics/LatencyPanel";
import { RecordPanel } from "./features/metrics/RecordPanel";
import { ResultsPanel } from "./features/metrics/ResultsPanel";
import { MODES, type Mode } from "./modes";
import { getModel } from "./services/api";
import { loadPartAssets } from "./three/partAssets";
import { useLabStore } from "./store/labStore";
import { GearboxScene } from "./three/GearboxScene";
import { useModeRoute } from "./useHashRoute";
import { RacingView } from "./features/racing/RacingView";
import { MotionLab } from "./features/motion-lab/MotionLab";
import { CrumpleDemo } from "./features/crumple/CrumpleDemo";

function useInputSources(canvas: HTMLCanvasElement | null, enabled: boolean) {
  useEffect(() => {
    const keyboard = new KeyboardCommandSource(window);
    keyboard.start(commandBus);
    if (!enabled) return () => keyboard.stop();
    const gestures = HAND_IDS.map((id) => new GestureCommandSource(
      gestureEventBus.subscribe, (c) => {
        const store = useLabStore.getState();
        store.setHandCursor(id, c);
        if (!c) store.setInteraction(id, { hovered: null, armed: false });
      }, id,
    ));
    const twoHands = new TwoHandCommandSource(handFrameBus.subscribe, () => performance.now(),
      () => {
        const state = useLabStore.getState();
        return state.pendingParts.length > 0 || Object.values(state.interactions).some((v) => !!v.dragging);
      });
    gestures.forEach((g) => g.start(commandBus));
    twoHands.start(commandBus);
    const unsub = commandBus.subscribe(({ command, source }) => {
      if (command.type !== "HOVER" && command.type !== "MOVE_PART") {
        useLabStore.getState().setLastCommand(`${command.type} (${source})`);
      }
    });
    return () => {
      keyboard.stop();
      gestures.forEach((g) => g.stop());
      twoHands.stop();
      unsub();
    };
  }, [enabled]);

  useEffect(() => {
    if (!canvas || !enabled) return;
    const mouse = new MouseCommandSource(canvas);
    mouse.start(commandBus);
    return () => mouse.stop();
  }, [canvas, enabled]);
}

function SelectedPartCard() {
  const model = useLabStore((s) => s.model);
  const selectedId = useLabStore((s) => s.selectedPartId);
  const selected = model?.parts.find((p) => p.part_id === selectedId);
  if (!selected) return null;
  return (
    <div className={styles.partCard}>
      <strong>{selected.name}</strong>
      <p>{selected.function}</p>
    </div>
  );
}

function HoveredPartName() {
  const model = useLabStore((s) => s.model);
  const interactions = useLabStore((s) => s.interactions);
  const cursors = useLabStore((s) => s.handCursors);
  return <div role="status" style={{ display: "grid", gap: 4, fontSize: 13 }}>
    {HAND_IDS.map((hand) => {
      const cursor = cursors[hand];
      if (!cursor) return null;
      const target = interactions[hand];
      const part = model?.parts.find((p) => p.part_id === (target?.dragging ?? target?.hovered));
      return <div key={hand} style={{ color: hand === "left" ? "#58a6ff" : "#f2cc60" }}>
        {hand === "left" ? "왼손" : "오른손"}: {part ? `${part.name} · ${target?.dragging ? "이동 중" : target?.armed ? "선택 고정 · 손가락을 붙여 주세요" : "집어서 선택"}` : "검지로 부품을 가리켜 주세요"}
      </div>;
    })}
  </div>;
}

function ModePanel({ mode }: { mode: Mode }) {
  switch (mode) {
    case "record":
      return <RecordPanel />;
    case "lab":
      return <SelectedPartCard />;
    case "disassemble":
      return <PartListPanel />;
    case "assemble":
      return <AssemblyPanel />;
    case "operate":
      return <OperatePanel />;
    case "tutor":
      return <TutorPanel />;
    case "results":
      return <ResultsPanel />;
    default:
      return <SelectedPartCard />;
  }
}

export default function App() {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const model = useLabStore((s) => s.model);
  const loadError = useLabStore((s) => s.loadError);
  const lastCommand = useLabStore((s) => s.lastCommand);
  const offline = useLabStore((s) => s.offline);
  const camera = useCamera();
  const mode = useModeRoute();
  const gameMode = mode === "racing" || mode === "motionlab" || mode === "crumple";
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const poseOverlayRef = useRef<HTMLCanvasElement>(null);

  useHandTracking(camera.videoRef, overlayRef, camera.status === "on");
  useGesturePipeline();
  useInputSources(canvas, !gameMode);
  useDisassembleMode();
  useAssemblyMode();
  useOperateMode();
  useTutorMode();
  useEffect(installDebugApi, []);

  useEffect(() => {
    getModel("gearbox")
      .then(({ model: m, offline }) => useLabStore.getState().setModel(m, offline))
      .catch((e: Error) => useLabStore.getState().setLoadError(e.message));
    // GLB 에셋 목록 (없으면 절차적 형상만)
    void loadPartAssets("gearbox").then((assets) => useLabStore.getState().setPartAssets(assets));
  }, []);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1>HoloForge AI Lab</h1>
        <span className={styles.subtitle}>{mode === "crumple" ? "모션 인터랙션 · 창 구기기" : gameMode ? "게임 모션 실험실" : model?.meta.name ?? "모델 불러오는 중…"}</span>
        <nav className={styles.nav} aria-label="모드">
          {MODES.map((m) => (
            <a
              key={m.id}
              href={`#/${m.id}`}
              aria-current={mode === m.id ? "page" : undefined}
              title={`단축키 ${m.key}`}
            >
              {m.label}
            </a>
          ))}
        </nav>
      </header>
      <main className={styles.stage}>
        {mode === "crumple" ? <CrumpleDemo /> : mode === "motionlab" ? <MotionLab videoRef={camera.videoRef} poseOverlayRef={poseOverlayRef} cameraOn={camera.status === "on"} /> : mode === "racing" ? <RacingView videoRef={camera.videoRef} /> : <GearboxScene onCanvas={setCanvas} />}
        <AssemblyToast />
        {!gameMode && loadError && <div className={styles.error}>모델을 불러오지 못했습니다: {loadError}</div>}
        {!gameMode && offline && (
          <div className={styles.error} data-testid="offline-banner">
            백엔드 없이 보기 전용으로 실행 중입니다. 조립 판정·작동·AI 튜터는 백엔드를 켜야 동작합니다.
          </div>
        )}
        <CameraPanel
          compact={gameMode}
          videoRef={camera.videoRef}
          status={camera.status}
          error={camera.error}
          onStart={camera.start}
          onStop={camera.stop}
          idleHint={mode === "crumple" ? "카메라를 켜면 양손으로 창을 구길 수 있습니다" : gameMode ? "카메라를 켜면 게임 모션을 테스트할 수 있습니다" : undefined}
          overlay={<><canvas ref={overlayRef} /><canvas ref={poseOverlayRef} /></>}
        >
          <TrackingStatus compact={gameMode} />
          {!gameMode && <LatencyPanel />}
        </CameraPanel>
        {!gameMode && <aside className={styles.hud} data-testid="mode-panel" data-mode={mode}>
          <GestureHud />
          <HoveredPartName />
          <ModePanel mode={mode} />
          <div className={styles.lastCommand}>
            <strong>마지막 명령</strong> {lastCommand ?? "-"}
          </div>
          <div className={styles.help}>
            양손 동시 조작: 왼손·오른손으로 각각 다른 부품 선택·이동 · ☝️ 검지만 펴면 선택 모드 → 강조된 부품을 🤏 집어서 이동 · 손가락을 떼면 놓기 · 조립: 현재 단계의 부품을 자기 자리 근처로 가져가면 자동 결합 · 🤏 한 손으로 잡고 다른 손을 ✋ 펼쳐 움직이면 모델 회전 · ✊ 해당 손의 조작 취소 (Esc는 모두 취소) / 마우스: 드래그로 이동, 빈 곳·오른쪽 드래그로 회전 /
            키: 1~9 모드, 0 창 구기기, Esc 취소
          </div>
        </aside>}
      </main>
      <footer className={styles.footer}>교육용 시각화이며 실제 설계·제조·안전 판단에 사용할 수 없습니다.</footer>
    </div>
  );
}
