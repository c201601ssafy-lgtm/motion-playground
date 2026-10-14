// D-002 규칙 기반 분류기. 백엔드 app/gestures/rule_classifier.py 와 동일 규칙.

import type { HandFrame } from "../hand-tracking/types";
import type { Classification, GestureType } from "./types";

export const CLASSIFIER_PARAMS = {
  /** 정규화 집기 거리가 이보다 작으면 PINCH 시작 */
  pinchEnter: 0.35,
  /** PINCH 중에는 이보다 커져야 해제 (히스테리시스) */
  pinchExit: 0.5,
};

type ClassifierInput = Pick<HandFrame, "confidence" | "pinch_distance" | "finger_states" | "finger_folded">;

/**
 * 우선순위: PINCH > OPEN_PALM > FIST > NONE.
 * PINCH는 검지가 접히지 않았을 때만 (주먹 쥘 때 엄지·검지가 가까워지는 경우 제외).
 */
export function classify(frame: ClassifierInput | null, prev: GestureType = "NONE"): Classification {
  if (!frame) return { type: "NONE", confidence: 0 };
  const { pinch_distance: pinch, finger_states: ext, finger_folded: folded, confidence } = frame;
  const pinchLimit = prev === "PINCH" ? CLASSIFIER_PARAMS.pinchExit : CLASSIFIER_PARAMS.pinchEnter;

  let type: GestureType = "NONE";
  if (pinch < pinchLimit && !folded.index) type = "PINCH";
  // 엄지는 가려지거나 오검출이 잦아 판정에서 뺀다 (D-014)
  else if (ext.index && ext.middle && ext.ring && ext.pinky) type = "OPEN_PALM";
  else if (ext.index && folded.middle && folded.ring && folded.pinky) type = "POINT";
  else if (folded.index && folded.middle && folded.ring && folded.pinky) type = "FIST";
  return { type, confidence };
}
