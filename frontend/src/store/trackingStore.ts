import { create } from "zustand";
import type { FingerStates } from "../features/hand-tracking/types";

// HUD 표시용 상태. 프레임마다가 아니라 ~10Hz로만 갱신한다 (렌더 부담 방지).

export type TrackerStatus = "idle" | "loading" | "running" | "error";

export interface TrackingState {
  trackerStatus: TrackerStatus;
  trackerError: string | null;
  delegate: "GPU" | "CPU" | null;
  fps: number;
  handDetected: boolean;
  handedness: "left" | "right" | null;
  confidence: number;
  fingerStates: FingerStates | null;
  pinchDistance: number | null;
  showOverlay: boolean;
  set: (patch: Partial<Omit<TrackingState, "set">>) => void;
}

export const useTrackingStore = create<TrackingState>((set) => ({
  trackerStatus: "idle",
  trackerError: null,
  delegate: null,
  fps: 0,
  handDetected: false,
  handedness: null,
  confidence: 0,
  fingerStates: null,
  pinchDistance: null,
  showOverlay: true,
  set: (patch) => set(patch),
}));
