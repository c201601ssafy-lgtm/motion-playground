import { useEffect, useRef, useState } from "react";
import styles from "./App.module.css";
import { CameraPanel } from "./features/camera/CameraPanel";
import { useCamera } from "./features/camera/useCamera";
import { commandBus } from "./features/commands/commandBus";
import { KeyboardCommandSource } from "./features/commands/keyboardSource";
import { MouseCommandSource } from "./features/commands/mouseSource";
import { GestureHud } from "./features/gestures/GestureHud";
import { installDebugApi } from "./features/gestures/simulator";
import { useGesturePipeline } from "./features/gestures/useGesturePipeline";
import { TrackingStatus } from "./features/hand-tracking/TrackingStatus";
import { useHandTracking } from "./features/hand-tracking/useHandTracking";
import { getModel } from "./services/api";
import { useLabStore } from "./store/labStore";
import { GearboxScene } from "./three/GearboxScene";

export default function App() {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const model = useLabStore((s) => s.model);
  const loadError = useLabStore((s) => s.loadError);
  const selectedId = useLabStore((s) => s.selectedPartId);
  const lastCommand = useLabStore((s) => s.lastCommand);
  const camera = useCamera();
  const overlayRef = useRef<HTMLCanvasElement>(null);
  useHandTracking(camera.videoRef, overlayRef, camera.status === "on");
  useGesturePipeline();
  useEffect(installDebugApi, []);
  const selected = model?.parts.find((p) => p.part_id === selectedId);

  useEffect(() => {
    getModel("gearbox")
      .then((m) => useLabStore.getState().setModel(m))
      .catch((e: Error) => useLabStore.getState().setLoadError(e.message));
  }, []);

  useEffect(() => {
    const keyboard = new KeyboardCommandSource(window);
    keyboard.start(commandBus);
    const unsub = commandBus.subscribe(({ command, source }) => {
      if (command.type !== "HOVER" && command.type !== "MOVE_PART") {
        useLabStore.getState().setLastCommand(`${command.type} (${source})`);
      }
    });
    return () => {
      keyboard.stop();
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!canvas) return;
    const mouse = new MouseCommandSource(canvas);
    mouse.start(commandBus);
    return () => mouse.stop();
  }, [canvas]);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1>HoloForge AI Lab</h1>
        <span className={styles.subtitle}>{model?.meta.name ?? "모델 불러오는 중…"}</span>
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
        </CameraPanel>
        <aside className={styles.hud}>
          <GestureHud />
          <div>
            <strong>마지막 명령</strong> {lastCommand ?? "-"}
          </div>
          {selected && (
            <div className={styles.partCard}>
              <strong>{selected.name}</strong>
              <p>{selected.function}</p>
            </div>
          )}
          <div className={styles.help}>
            왼쪽 클릭: 부품 선택 · 빈 곳 드래그/오른쪽 드래그/방향키: 회전 · Esc: 선택 해제
          </div>
        </aside>
      </main>
      <footer className={styles.footer}>
        교육용 시각화이며 실제 설계·제조·안전 판단에 사용할 수 없습니다.
      </footer>
    </div>
  );
}
