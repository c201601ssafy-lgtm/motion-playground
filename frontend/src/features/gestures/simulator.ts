// 디버그용 가상 손: 웹캠 없이 합성 HandFrame을 handFrameBus에 흘려 파이프라인 전체를 시험한다.
// 브라우저 콘솔 예:
//   holoforgeDebug.handScreen("PINCH", 0.6, 0.5)   // 캔버스 화면 좌표에 집기
//   holoforgeDebug.hand(null)                      // 손 치우기
//   holoforgeDebug.state()                         // 씬 상태 확인

import { useLabStore } from "../../store/labStore";
import { useTrackingStore } from "../../store/trackingStore";
import { handFrameBus } from "../hand-tracking/frameBus";
import { LM } from "../hand-tracking/types";
import { buildHandFrame } from "./features";
import { GESTURE_MAPPING } from "./gestureCommandSource";
import { POSES, syntheticHand } from "./synthetic";

type PoseName = keyof typeof POSES;

let timer: ReturnType<typeof setInterval> | null = null;
let state: { pose: PoseName | null; x: number; y: number } = { pose: null, x: 0.5, y: 0.5 };

const PINCH_POSES = new Set<PoseName>(["PINCH", "PINCH_OK"]);

/** 제스처 기준점(집기=손끝 중점, 그 외=손바닥 중심)이 (x, y)에 오도록 손을 배치한다. */
function placedHand(pose: PoseName, x: number, y: number) {
  const lm = syntheticHand(POSES[pose], { scale: 0.18 });
  const ref = PINCH_POSES.has(pose)
    ? { x: (lm[LM.THUMB_TIP]!.x + lm[LM.INDEX_TIP]!.x) / 2, y: (lm[LM.THUMB_TIP]!.y + lm[LM.INDEX_TIP]!.y) / 2 }
    : buildHandFrame(lm, "right", 1, 0).palm_center;
  return lm.map((p) => ({ x: p.x + x - ref.x, y: p.y + y - ref.y, z: p.z }));
}

function tick() {
  const now = performance.now();
  if (!state.pose) {
    handFrameBus.publish(null, { captureAt: now, landmarkMs: 0 });
    return;
  }
  handFrameBus.publish(buildHandFrame(placedHand(state.pose, state.x, state.y), "right", 0.95, now), {
    captureAt: now,
    landmarkMs: 0,
  });
}

export const handSimulator = {
  /** 이미지 좌표(거울 반전 전)에 포즈를 둔다. pose=null이면 손이 사라짐. */
  hand(pose: PoseName | null, x = state.x, y = state.y) {
    state = { pose, x, y };
    if (!timer) timer = setInterval(tick, 33);
  },
  /** 캔버스 화면 좌표(0..1)에 포즈를 둔다 (toScreen의 역변환). */
  handScreen(pose: PoseName | null, sx: number, sy: number) {
    const g = GESTURE_MAPPING.screenGain;
    this.hand(pose, 1 - (0.5 + (sx - 0.5) / g), 0.5 + (sy - 0.5) / g);
  },
  stop() {
    if (timer) clearInterval(timer);
    timer = null;
    state = { pose: null, x: 0.5, y: 0.5 };
  },
  state() {
    const s = useLabStore.getState();
    const t = useTrackingStore.getState();
    return {
      yaw: s.yaw,
      pitch: s.pitch,
      hovered: s.hoveredPartId,
      selected: s.selectedPartId,
      dragging: s.draggingPartId,
      poses: s.poses,
      cursor: s.cursor,
      lastCommand: s.lastCommand,
      gesture: t.gesture,
      exploded: s.exploded,
      focus: s.focusPartId,
      mode: s.mode,
      offline: s.offline,
    };
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
