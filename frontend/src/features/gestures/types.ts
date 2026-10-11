// D-004 공통 제스처 이벤트 스키마. schemas/gesture-event.schema.json 과 같은 구조.

export type GestureType = "NONE" | "OPEN_PALM" | "PINCH" | "FIST";
export const GESTURE_TYPES: GestureType[] = ["NONE", "OPEN_PALM", "PINCH", "FIST"];

export interface Classification {
  type: GestureType;
  confidence: number;
}

export interface GestureEvent {
  type: Exclude<GestureType, "NONE">;
  phase: "start" | "hold" | "end";
  /** 정규화 이미지 좌표 (거울 반전 전), 필터 적용 후 */
  position: { x: number; y: number; z: number };
  /** 이전 이벤트 대비 이동량 */
  delta: { x: number; y: number };
  /** 손 기울기(°, HandFrame.roll_deg). 집은 채 손목을 돌려 부품을 돌릴 때 쓴다 */
  roll?: number;
  confidence: number;
  timestamp: number;
}
