// 디버그용 가상 손: 웹캠 없이 합성 HandFrame을 handFrameBus에 흘려 파이프라인 전체를 시험한다.
// 브라우저 콘솔 예:
//   holoforgeDebug.handScreen("PINCH", 0.6, 0.5)   // 캔버스 화면 좌표에 집기
//   holoforgeDebug.handScreen("PINCH", 0.6, 0.5, 0.5)  // 손을 0.5rad 기울여 집기 (손목 회전)
//   holoforgeDebug.hand(null)                      // 손 치우기
//   holoforgeDebug.state()                         // 씬 상태 확인

import { useAssemblyStore } from "../../store/assemblyStore";
import { useLabStore } from "../../store/labStore";
import { partMeshes, projectModelPoint, projectPart } from "../../three/sceneProbe";
import { useTrackingStore } from "../../store/trackingStore";
import { handFrameBus } from "../hand-tracking/frameBus";
import { LM } from "../hand-tracking/types";
import { buildHandFrame } from "./features";
import { GESTURE_MAPPING } from "./gestureCommandSource";
import { POSES, syntheticHand } from "./synthetic";

type PoseName = keyof typeof POSES;

let timer: ReturnType<typeof setInterval> | null = null;
let state: { pose: PoseName | null; x: number; y: number; roll: number } = { pose: null, x: 0.5, y: 0.5, roll: 0 };
/** 두 번째 손 (양손 제스처 시험용). null이면 한 손 */
let second: { pose: PoseName; x: number; y: number } | null = null;

const PINCH_POSES = new Set<PoseName>(["PINCH", "PINCH_OK"]);

/** 제스처 기준점(집기=손끝 중점, 그 외=손바닥 중심)이 (x, y)에 오도록 손을 배치한다. */
function placedHand(pose: PoseName, x: number, y: number, roll = 0) {
  const lm = syntheticHand(POSES[pose], { scale: 0.18, roll });
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
  const primary = buildHandFrame(placedHand(state.pose, state.x, state.y, state.roll), "right", 0.95, now);
  const hands = [primary];
  if (second) hands.push(buildHandFrame(placedHand(second.pose, second.x, second.y), "left", 0.95, now));
  handFrameBus.publish(primary, { captureAt: now, landmarkMs: 0 }, hands);
}

export const handSimulator = {
  /** 이미지 좌표(거울 반전 전)에 포즈를 둔다. pose=null이면 손이 사라짐. */
  hand(pose: PoseName | null, x = state.x, y = state.y, roll = 0) {
    state = { pose, x, y, roll };
    if (!pose) second = null;
    if (!timer) timer = setInterval(tick, 33);
  },
  /** 캔버스 화면 좌표(0..1)에 포즈를 둔다 (toScreen의 역변환). */
  handScreen(pose: PoseName | null, sx: number, sy: number, roll = 0) {
    const g = GESTURE_MAPPING.screenGain;
    this.hand(pose, 1 - (0.5 + (sx - 0.5) / g), 0.5 + (sy - 0.5) / g, roll);
  },
  /** 두 손을 화면 중앙 기준 좌우로 sep(이미지 폭 비율)만큼 벌려 둔다. sep=null이면 두 손 모두 치운다. */
  twoHands(sep: number | null, pose: PoseName = "OPEN_PALM") {
    if (sep === null) {
      this.hand(null);
      return;
    }
    this.hand(pose, 0.5 + sep / 2, 0.5);
    second = { pose, x: 0.5 - sep / 2, y: 0.5 };
  },
  stop() {
    if (timer) clearInterval(timer);
    timer = null;
    state = { pose: null, x: 0.5, y: 0.5, roll: 0 };
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
      spins: s.spins,
      hidden: s.hiddenParts,
    };
  },
  /** 부품의 현재 화면 좌표 */
  screenOfPart(partId: string) {
    return projectPart(partId);
  },
  /** 모델 좌표의 화면 좌표 */
  screenOfPoint(x: number, y: number, z: number) {
    return projectModelPoint([x, y, z]);
  },
  /** 부품을 이루는 메시 (GLB 교체 확인용) */
  partMeshes(partId: string) {
    return partMeshes(partId);
  },
  /** 결합 지점의 화면 좌표 */
  screenOfSlot(slotId: string) {
    const slot = useLabStore.getState().model?.slots.find((s) => s.slot_id === slotId);
    return slot ? projectModelPoint(slot.position) : null;
  },
  assembly() {
    const a = useAssemblyStore.getState();
    return { sessionId: a.sessionId, snapshot: a.snapshot, lastResult: a.lastResult, toast: a.toast, attempts: a.attempts, errors: a.errors };
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
