// 디버그용 가상 손: 웹캠 없이 합성 HandFrame을 handFrameBus에 흘려 파이프라인 전체를 시험한다.
// 브라우저 콘솔: holoforgeDebug.hand("PINCH", 0.4, 0.6)  /  holoforgeDebug.stop()

import { handFrameBus } from "../hand-tracking/frameBus";
import { buildHandFrame } from "./features";
import { POSES, syntheticHand } from "./synthetic";

type PoseName = keyof typeof POSES;

let timer: ReturnType<typeof setInterval> | null = null;
let state: { pose: PoseName | null; x: number; y: number } = { pose: null, x: 0.5, y: 0.5 };

function tick() {
  const now = performance.now();
  if (!state.pose) {
    handFrameBus.publish(null, { captureAt: now, landmarkMs: 0 });
    return;
  }
  // (x, y)는 손목 위치가 아니라 손 중심 근처를 가리키도록 아래로 보정
  const lm = syntheticHand(POSES[state.pose], { wrist: { x: state.x, y: state.y + 0.15 }, scale: 0.18 });
  handFrameBus.publish(buildHandFrame(lm, "right", 0.95, now), { captureAt: now, landmarkMs: 0 });
}

export const handSimulator = {
  /** 포즈와 위치(정규화 이미지 좌표, 거울 반전 전)를 정한다. pose=null이면 손이 사라짐. */
  hand(pose: PoseName | null, x = state.x, y = state.y) {
    state = { pose, x, y };
    if (!timer) timer = setInterval(tick, 33);
  },
  stop() {
    if (timer) clearInterval(timer);
    timer = null;
    state = { pose: null, x: 0.5, y: 0.5 };
  },
  poses: Object.keys(POSES) as PoseName[],
};

declare global {
  interface Window {
    holoforgeDebug?: typeof handSimulator;
  }
}

export function installDebugApi() {
  window.holoforgeDebug = handSimulator;
}
