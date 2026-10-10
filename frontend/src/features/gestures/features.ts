// 랜드마크 → 제스처 특징. 순수 함수 (React·MediaPipe 의존 없음).
// 백엔드 app/gestures/features.py 와 같은 계산을 한다 (evals/gesture-cases.jsonl 로 동일성 검증).

import type { FingerStates, HandFrame, Landmark } from "../hand-tracking/types";
import { LM } from "../hand-tracking/types";

export const FEATURE_PARAMS = {
  /** 손가락 마디가 이 각도(°)보다 덜 굽으면 펴진 것 */
  fingerStraightMaxDeg: 60,
  thumbStraightMaxDeg: 50,
  /** 엄지끝-검지 MCP 거리 / 손 크기 가 이보다 크면 엄지 펴짐 */
  thumbSpreadMin: 0.55,
};

type P = Landmark;

/** x를 종횡비로 보정해 x, y 축척을 맞춘다 (정규화 좌표는 축마다 이미지 크기로 나뉨). */
function scaled(lm: P[], aspect: number): P[] {
  return lm.map((p) => ({ x: p.x * aspect, y: p.y, z: p.z * aspect }));
}

const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v: P) => Math.hypot(v.x, v.y, v.z);
const dist2d = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

/** 두 마디 벡터 사이 굽힘 각도(°). 0 = 일직선. */
function bendDeg(a: P, b: P, c: P): number {
  const u = sub(b, a);
  const v = sub(c, b);
  const lu = len(u);
  const lv = len(v);
  if (lu === 0 || lv === 0) return 180;
  const cos = (u.x * v.x + u.y * v.y + u.z * v.z) / (lu * lv);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

const FINGER_JOINTS = {
  index: [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  middle: [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  ring: [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  pinky: [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
} as const;

export function handSize(lm: P[]): number {
  return dist2d(lm[LM.WRIST]!, lm[LM.MIDDLE_MCP]!);
}

export function fingerStates(lmRaw: P[], aspect = 1): FingerStates {
  const lm = scaled(lmRaw, aspect);
  const size = handSize(lm) || 1e-6;
  const at = (i: number) => lm[i]!;
  const wrist = at(LM.WRIST);

  const finger = ([mcp, pip, dip, tip]: readonly number[]) => {
    const bend = bendDeg(at(mcp!), at(pip!), at(tip!)) + bendDeg(at(pip!), at(dip!), at(tip!)) / 2;
    const farther = dist2d(wrist, at(tip!)) > dist2d(wrist, at(pip!));
    return bend < FEATURE_PARAMS.fingerStraightMaxDeg && farther;
  };

  const thumbBend = bendDeg(at(LM.THUMB_MCP), at(LM.THUMB_IP), at(LM.THUMB_TIP));
  const thumbSpread = dist2d(at(LM.THUMB_TIP), at(LM.INDEX_MCP)) / size;

  return {
    thumb: thumbBend < FEATURE_PARAMS.thumbStraightMaxDeg && thumbSpread > FEATURE_PARAMS.thumbSpreadMin,
    index: finger(FINGER_JOINTS.index),
    middle: finger(FINGER_JOINTS.middle),
    ring: finger(FINGER_JOINTS.ring),
    pinky: finger(FINGER_JOINTS.pinky),
  };
}

export function fingerFolded(lmRaw: P[], aspect = 1): HandFrame["finger_folded"] {
  const lm = scaled(lmRaw, aspect);
  const wrist = lm[LM.WRIST]!;
  const folded = ([, pip, , tip]: readonly number[]) =>
    dist2d(wrist, lm[tip!]!) < dist2d(wrist, lm[pip!]!);
  return {
    index: folded(FINGER_JOINTS.index),
    middle: folded(FINGER_JOINTS.middle),
    ring: folded(FINGER_JOINTS.ring),
    pinky: folded(FINGER_JOINTS.pinky),
  };
}

export function pinchDistance(lmRaw: P[], aspect = 1): number {
  const lm = scaled(lmRaw, aspect);
  return dist2d(lm[LM.THUMB_TIP]!, lm[LM.INDEX_TIP]!) / (handSize(lm) || 1e-6);
}

export function palmCenter(lm: P[]): P {
  const ids = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  const sum = ids.reduce((acc, i) => ({ x: acc.x + lm[i]!.x, y: acc.y + lm[i]!.y, z: acc.z + lm[i]!.z }), {
    x: 0,
    y: 0,
    z: 0,
  });
  return { x: sum.x / ids.length, y: sum.y / ids.length, z: sum.z / ids.length };
}

export function buildHandFrame(
  landmarks: P[],
  handedness: "left" | "right",
  confidence: number,
  timestamp: number,
  aspect = 1,
): HandFrame {
  return {
    handedness,
    confidence,
    landmarks,
    palm_center: palmCenter(landmarks),
    pinch_distance: pinchDistance(landmarks, aspect),
    finger_states: fingerStates(landmarks, aspect),
    finger_folded: fingerFolded(landmarks, aspect),
    hand_size: handSize(scaled(landmarks, aspect)),
    timestamp,
  };
}
