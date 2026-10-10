import { useEffect, useRef, useState } from "react";
import styles from "./App.module.css";
import { CameraPanel } from "./features/camera/CameraPanel";
import { useCamera } from "./features/camera/useCamera";
import { commandBus } from "./features/commands/commandBus";
import { KeyboardCommandSource } from "./features/commands/keyboardSource";
import { MouseCommandSource } from "./features/commands/mouseSource";
import { GestureCommandSource } from "./features/gestures/gestureCommandSource";
import { gestureEventBus } from "./features/gestures/gestureEventBus";
import { GestureHud } from "./features/gestures/GestureHud";
import { installDebugApi } from "./features/gestures/simulator";
import { useGesturePipeline } from "./features/gestures/useGesturePipeline";
import { TrackingStatus } from "./features/hand-tracking/TrackingStatus";
import { useHandTracking } from "./features/hand-tracking/useHandTracking";
import { LatencyPanel } from "./features/metrics/LatencyPanel";
import { RecordPanel } from "./features/metrics/RecordPanel";
import { MODES, type Mode } from "./modes";
import { getModel } from "./services/api";
import { useLabStore } from "./store/labStore";
import { GearboxScene } from "./three/GearboxScene";
import { useModeRoute } from "./useHashRoute";

function useInputSources(canvas: HTMLCanvasElement | null) {
  useEffect(() => {
    const keyboard = new KeyboardCommandSource(window);
    const gestures = new GestureCommandSource(gestureEventBus.subscribe, (c) => useLabStore.getState().setCursor(c));
    keyboard.start(commandBus);
    gestures.start(commandBus);
    const unsub = commandBus.subscribe(({ command, source }) => {
      if (command.type !== "HOVER" && command.type !== "MOVE_PART") {
        useLabStore.getState().setLastCommand(`${command.type} (${source})`);
      }
    });
    return () => {
      keyboard.stop();
      gestures.stop();
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!canvas) return;
    const mouse = new MouseCommandSource(canvas);
    mouse.start(commandBus);
    return () => mouse.stop();
  }, [canvas]);
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

function ModePanel({ mode }: { mode: Mode }) {
  switch (mode) {
    case "record":
      return <RecordPanel />;
    case "lab":
      return <SelectedPartCard />;
    default:
      return (
        <>
          <SelectedPartCard />
          <p className={styles.help}>이 모드는 준비 중입니다.</p>
        </>
      );
  }
}

export default function App() {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const model = useLabStore((s) => s.model);
  const loadError = useLabStore((s) => s.loadError);
  const lastCommand = useLabStore((s) => s.lastCommand);
  const camera = useCamera();
  const mode = useModeRoute();
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useHandTracking(camera.videoRef, overlayRef, camera.status === "on");
  useGesturePipeline();
  useInputSources(canvas);
  useEffect(installDebugApi, []);

  useEffect(() => {
    getModel("gearbox")
      .then((m) => useLabStore.getState().setModel(m))
      .catch((e: Error) => useLabStore.getState().setLoadError(e.message));
  }, []);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1>HoloForge AI Lab</h1>
        <span className={styles.subtitle}>{model?.meta.name ?? "모델 불러오는 중…"}</span>
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
        <GearboxScene onCanvas={setCanvas} />
        {loadError && <div className={styles.error}>모델을 불러오지 못했습니다: {loadError}</div>}
        <CameraPanel
          videoRef={camera.videoRef}
          status={camera.status}
          error={camera.error}
          onStart={camera.start}
          onStop={camera.stop}
          overlay={<canvas ref={overlayRef} />}
        >
          <TrackingStatus />
          <LatencyPanel />
        </CameraPanel>
        <aside className={styles.hud} data-testid="mode-panel" data-mode={mode}>
          <GestureHud />
          <ModePanel mode={mode} />
          <div className={styles.lastCommand}>
            <strong>마지막 명령</strong> {lastCommand ?? "-"}
          </div>
          <div className={styles.help}>
            🤏 집어서 부품 이동 · ✋ 펼친 손 움직여 회전 · ✊ 취소 / 마우스: 드래그로 이동, 빈 곳·오른쪽 드래그로 회전 /
            키: 1~7 모드, Esc 취소
          </div>
        </aside>
      </main>
      <footer className={styles.footer}>교육용 시각화이며 실제 설계·제조·안전 판단에 사용할 수 없습니다.</footer>
    </div>
  );
}
