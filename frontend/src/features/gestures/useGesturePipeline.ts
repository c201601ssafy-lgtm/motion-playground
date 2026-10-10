import { useEffect } from "react";
import { useTrackingStore } from "../../store/trackingStore";
import { handFrameBus } from "../hand-tracking/frameBus";
import { gestureEventBus } from "./gestureEventBus";
import { GesturePipeline } from "./pipeline";

const HUD_INTERVAL_MS = 100;

/** handFrameBus → GesturePipeline → gestureEventBus. HUD 상태도 갱신한다. */
export function useGesturePipeline() {
  useEffect(() => {
    const pipeline = new GesturePipeline(useTrackingStore.getState().filter);
    let lastHud = 0;

    const unsubFilter = useTrackingStore.subscribe((s, prev) => {
      if (s.filter !== prev.filter) pipeline.setFilter(s.filter);
    });

    const unsubFrames = handFrameBus.subscribe((frame) => {
      const now = performance.now();
      const { classification, events } = pipeline.process(frame, now);
      for (const e of events) gestureEventBus.publish(e);
      const last = events[events.length - 1];
      const changed = events.some((e) => e.phase !== "hold");
      if (changed || now - lastHud > HUD_INTERVAL_MS) {
        lastHud = now;
        useTrackingStore.getState().set({
          gesture: pipeline.machine.current,
          gesturePhase: last?.phase ?? null,
          gestureConfidence: last?.confidence ?? 0,
          rawGesture: classification.type,
        });
      }
    });

    return () => {
      unsubFrames();
      unsubFilter();
    };
  }, []);
}
