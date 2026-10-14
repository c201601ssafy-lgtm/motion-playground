import { useEffect } from "react";
import { useTrackingStore } from "../../store/trackingStore";
import { handFrameBus } from "../hand-tracking/frameBus";
import { latency } from "../metrics/latency";
import { gestureEventBus } from "./gestureEventBus";
import { MultiHandPipeline } from "./multiHandPipeline";
import { useLabStore } from "../../store/labStore";

const HUD_INTERVAL_MS = 100;

/** handFrameBus → GesturePipeline → gestureEventBus. HUD 상태도 갱신한다. */
export function useGesturePipeline() {
  useEffect(() => {
    const pipeline = new MultiHandPipeline(useTrackingStore.getState().filter);
    let lastHud = 0;

    const unsubFilter = useTrackingStore.subscribe((s, prev) => {
      if (s.filter !== prev.filter) pipeline.setFilter(s.filter);
      if (s.trackerStatus === "idle" && prev.trackerStatus !== "idle") {
        for (const e of pipeline.reset(performance.now())) gestureEventBus.publish(e);
        useLabStore.getState().setHandCursor("left", null);
        useLabStore.getState().setHandCursor("right", null);
      }
    });

    const unsubFrames = handFrameBus.subscribe((rawFrame, timing, hands) => {
      if (["racing", "motionlab", "crumple"].includes(useLabStore.getState().mode)) return;
      const now = performance.now();
      // 두 손을 펼치면 양손 제스처(분해·조립) 중이다. 손을 벌리는 움직임이 모델 회전으로 새지 않게 한 손 제스처를 멈춘다.
      const result = pipeline.process(hands, now);
      const { events } = result;
      const main = result.results.find((r) => r.id === rawFrame?.handedness) ?? result.results[0]!;
      useLabStore.getState().setHandRotationAllowed(result.allowRotation);
      const t1 = performance.now();
      for (const e of events) gestureEventBus.publish(e);
      const t2 = performance.now();
      if (hands.length) {
        latency.record("landmark", timing.landmarkMs);
        latency.record("gesture", t1 - now);
      }
      if (events.length) {
        latency.record("dispatch", t2 - t1);
        latency.record("endToEnd", t2 - timing.captureAt);
      }
      const last = events[events.length - 1];
      const changed = events.some((e) => e.phase !== "hold");
      if (changed || now - lastHud > HUD_INTERVAL_MS) {
        lastHud = now;
        useTrackingStore.getState().set({
          gesture: main.current,
          gesturePhase: last?.phase ?? null,
          gestureConfidence: last?.confidence ?? 0,
          rawGesture: main.classification.type,
        });
      }
    });
    const unsubMode = useLabStore.subscribe((s, prev) => {
      if (s.mode !== prev.mode) {
        for (const e of pipeline.reset(performance.now())) gestureEventBus.publish(e);
      }
    });

    return () => {
      unsubFrames();
      unsubFilter();
      unsubMode();
      for (const e of pipeline.reset(performance.now())) gestureEventBus.publish(e);
    };
  }, []);
}
