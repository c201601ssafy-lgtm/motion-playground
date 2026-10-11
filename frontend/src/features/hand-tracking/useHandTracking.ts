import { type RefObject, useEffect } from "react";
import { useTrackingStore } from "../../store/trackingStore";
import { drawLandmarks } from "./drawLandmarks";
import { handFrameBus } from "./frameBus";
import { HandTracker } from "./handTracker";

const HUD_INTERVAL_MS = 100;

/** 카메라가 켜져 있는 동안 HandTracker를 돌리고 프레임을 handFrameBus로 내보낸다. */
export function useHandTracking(
  videoRef: RefObject<HTMLVideoElement | null>,
  overlayRef: RefObject<HTMLCanvasElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    if (!video) return;
    const store = useTrackingStore.getState();
    let tracker: HandTracker | null = null;
    let cancelled = false;
    let lastHud = 0;
    let lastFrameAt = 0;
    let fps = 0;

    store.set({ trackerStatus: "loading", trackerError: null });
    HandTracker.create()
      .then((t) => {
        if (cancelled) {
          t.close();
          return;
        }
        tracker = t;
        useTrackingStore.getState().set({ trackerStatus: "running", delegate: t.delegate });
        t.start(video, (frame, timing, hands) => {
          const now = performance.now();
          if (lastFrameAt) fps = fps * 0.9 + (1000 / (now - lastFrameAt)) * 0.1;
          lastFrameAt = now;

          const overlay = overlayRef.current;
          if (overlay) {
            if (overlay.width !== video.videoWidth) overlay.width = video.videoWidth;
            if (overlay.height !== video.videoHeight) overlay.height = video.videoHeight;
            const show = useTrackingStore.getState().showOverlay;
            drawLandmarks(overlay, show ? frame : null);
            // 두 번째 손은 다른 색으로 겹쳐 그린다 (지우지 않음)
            if (show) for (const h of hands) if (h !== frame) drawLandmarks(overlay, h, "#58a6ff", false);
          }

          handFrameBus.publish(frame, timing, hands);

          if (now - lastHud > HUD_INTERVAL_MS) {
            lastHud = now;
            useTrackingStore.getState().set({
              fps: Math.round(fps),
              handDetected: !!frame,
              handedness: frame?.handedness ?? null,
              confidence: frame?.confidence ?? 0,
              fingerStates: frame?.finger_states ?? null,
              pinchDistance: frame?.pinch_distance ?? null,
            });
          }
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[HandTracker] 초기화 실패", err);
        useTrackingStore.getState().set({
          trackerStatus: "error",
          trackerError: "손 추적 모델을 불러오지 못했습니다. 네트워크를 확인하세요.",
        });
      });

    return () => {
      cancelled = true;
      tracker?.close();
      overlayRef.current?.getContext("2d")?.clearRect(0, 0, 9999, 9999);
      useTrackingStore.getState().set({ trackerStatus: "idle", fps: 0, handDetected: false });
    };
  }, [active, videoRef, overlayRef]);
}
