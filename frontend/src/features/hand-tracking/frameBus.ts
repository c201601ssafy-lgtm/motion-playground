import type { FrameTiming } from "./handTracker";
import type { HandFrame } from "./types";

// 전체 프레임레이트로 HandFrame을 받는 구독자(제스처 파이프라인, 녹화기)용.

export type HandFrameListener = (frame: HandFrame | null, timing: FrameTiming) => void;

const listeners = new Set<HandFrameListener>();

export const handFrameBus = {
  subscribe(listener: HandFrameListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  publish(frame: HandFrame | null, timing: FrameTiming): void {
    for (const l of [...listeners]) l(frame, timing);
  },
};
