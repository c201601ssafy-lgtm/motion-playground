import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { buildHandFrame } from "../gestures/features";
import type { HandFrame } from "./types";

// 에셋 경로. 오프라인 시연이 필요하면 public/ 아래로 옮기고 이 값만 바꾼다.
export const MEDIAPIPE_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
export const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export interface FrameTiming {
  /** 프레임이 화면에 표시될 예정 시각 (rVFC) 또는 루프 시작 시각 */
  captureAt: number;
  /** detectForVideo 소요 시간 ms */
  landmarkMs: number;
}

export type FrameListener = (frame: HandFrame | null, timing: FrameTiming) => void;

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { expectedDisplayTime?: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export class HandTracker {
  private running = false;
  private handle = 0;
  private lastVideoTime = -1;
  private video: VideoWithRvfc | null = null;
  private useRvfc = false;

  private constructor(
    private readonly landmarker: HandLandmarker,
    readonly delegate: "GPU" | "CPU",
  ) {}

  /** GPU 델리게이트를 먼저 시도하고 실패하면 CPU로 폴백한다. */
  static async create(numHands = 1): Promise<HandTracker> {
    // 카메라를 켤 때만 내려받는다 (초기 번들에서 제외)
    const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        const landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
          runningMode: "VIDEO",
          numHands,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        return new HandTracker(landmarker, delegate);
      } catch (err) {
        if (delegate === "CPU") throw err;
        console.warn("[HandTracker] GPU delegate 실패, CPU로 폴백", err);
      }
    }
    throw new Error("unreachable");
  }

  start(video: HTMLVideoElement, onFrame: FrameListener): void {
    if (this.running) return;
    this.running = true;
    const v = video as VideoWithRvfc;
    const useRvfc = typeof v.requestVideoFrameCallback === "function";

    const tick = (now: number) => {
      if (!this.running) return;
      if (video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = video.currentTime;
        const t0 = performance.now();
        const result = this.landmarker.detectForVideo(video, t0);
        const landmarkMs = performance.now() - t0;
        const lm = result.landmarks[0];
        const cat = result.handedness[0]?.[0];
        let frame: HandFrame | null = null;
        if (lm && lm.length === 21) {
          // MediaPipe의 handedness는 거울 반전 전 기준이라, 셀피 화면에서는 좌우가 뒤집혀 보인다.
          const label = cat?.categoryName?.toLowerCase() === "left" ? "right" : "left";
          const aspect = video.videoWidth / (video.videoHeight || 1);
          frame = buildHandFrame(
            lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
            label,
            cat?.score ?? 0,
            t0,
            aspect,
          );
        }
        onFrame(frame, { captureAt: now, landmarkMs });
      }
      this.handle = useRvfc ? v.requestVideoFrameCallback!(tick) : requestAnimationFrame(tick);
    };
    this.video = v;
    this.useRvfc = useRvfc;
    this.handle = useRvfc ? v.requestVideoFrameCallback!(tick) : requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.useRvfc) this.video?.cancelVideoFrameCallback?.(this.handle);
    else cancelAnimationFrame(this.handle);
    this.lastVideoTime = -1;
  }

  close(): void {
    this.stop();
    this.landmarker.close();
  }
}
