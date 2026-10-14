import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { buildHandFrame } from "../gestures/features";
import type { HandFrame } from "./types";
import { HandStabilizer } from "./stabilizer";

// 에셋 경로. 오프라인 시연이 필요하면 public/ 아래로 옮기고 이 값만 바꾼다.
export const MEDIAPIPE_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
export const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export interface FrameTiming {
  demo?: boolean;
  /** 프레임이 화면에 표시될 예정 시각 (rVFC) 또는 루프 시작 시각 */
  captureAt: number;
  /** detectForVideo 소요 시간 ms */
  landmarkMs: number;
}

/** frame: 주 손, hands: 보이는 모든 손 */
export type FrameListener = (frame: HandFrame | null, timing: FrameTiming, hands: HandFrame[]) => void;

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { expectedDisplayTime?: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** 손이 둘이면 직전 주 손과 가까운 쪽을 고른다 (손 순서가 프레임마다 바뀌어도 한 손 제스처가 끊기지 않게). */
export function pickPrimary(hands: HandFrame[], last: { x: number; y: number } | null): HandFrame | null {
  if (hands.length < 2 || !last) return hands[0] ?? null;
  const d = (h: HandFrame) => Math.hypot(h.palm_center.x - last.x, h.palm_center.y - last.y);
  return hands.reduce((best, h) => (d(h) < d(best) ? h : best));
}

export class HandTracker {
  private running = false;
  private handle = 0;
  private lastVideoTime = -1;
  private video: VideoWithRvfc | null = null;
  private useRvfc = false;
  /** 직전 주 손의 손바닥 위치. 손이 둘일 때 같은 손을 계속 주 손으로 고른다 */
  private lastPrimary: { x: number; y: number } | null = null;
  private lastPrimaryAt = -Infinity;
  private readonly stabilizer = new HandStabilizer();

  private constructor(
    private readonly landmarker: HandLandmarker,
    readonly delegate: "GPU" | "CPU",
  ) {}

  /** GPU 델리게이트를 먼저 시도하고 실패하면 CPU로 폴백한다. */
  static async create(numHands = 2): Promise<HandTracker> {
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
        const aspect = video.videoWidth / (video.videoHeight || 1);
        const hands: HandFrame[] = [];
        result.landmarks.forEach((lm, i) => {
          if (lm.length !== 21) return;
          const cat = result.handedness[i]?.[0];
          // CSS 반전은 미리보기에만 적용된다. 모델의 좌우 손 판정은 그대로 사용한다.
          const label = cat?.categoryName?.toLowerCase() === "left" ? "left" : "right";
          hands.push(buildHandFrame(lm.map((p) => ({ x: p.x, y: p.y, z: p.z })), label, cat?.score ?? 0, t0, aspect));
        });
        const stableHands = this.stabilizer.process(hands, t0, aspect);
        if (t0 - this.lastPrimaryAt > 200) this.lastPrimary = null;
        const frame = pickPrimary(stableHands, this.lastPrimary);
        if (frame) {
          this.lastPrimary = { x: frame.palm_center.x, y: frame.palm_center.y };
          this.lastPrimaryAt = t0;
        }
        onFrame(frame, { captureAt: now, landmarkMs }, stableHands);
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
    this.lastPrimary = null;
    this.lastPrimaryAt = -Infinity;
    this.stabilizer.reset();
  }

  close(): void {
    this.stop();
    this.landmarker.close();
  }
}
