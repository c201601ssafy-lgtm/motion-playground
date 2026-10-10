// spec §5 HandFrame. 좌표는 MediaPipe 정규화 이미지 좌표(x, y: 0..1, z: 손목 기준 상대 깊이).

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type Finger = "thumb" | "index" | "middle" | "ring" | "pinky";
export type FingerStates = Record<Finger, boolean>;

export interface HandFrame {
  handedness: "left" | "right";
  confidence: number;
  landmarks: Landmark[]; // 21개
  palm_center: Landmark;
  pinch_distance: number; // 엄지끝-검지끝 거리 / 손 크기
  finger_states: FingerStates;
  /** 손끝이 PIP보다 손목에 가까울 만큼 접혔는지 (엄지 제외). 주먹과 집기 구분용 */
  finger_folded: Record<Exclude<Finger, "thumb">, boolean>;
  hand_size: number; // 손목-중지 MCP 거리 (종횡비 보정)
  timestamp: number; // performance.now() ms
}

/** MediaPipe 손 랜드마크 인덱스 */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
