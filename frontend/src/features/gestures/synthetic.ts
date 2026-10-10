// 합성 손 랜드마크 생성기.
// 용도: 단위 테스트, evals/gesture-cases.jsonl 생성, 웹캠 없이 파이프라인을 돌리는 디버그 주입.
// 실제 손 데이터를 대체하지 않는다 (source: "synthetic" 으로 표기).

import type { Landmark } from "../hand-tracking/types";

export type ThumbPose = "extended" | "folded" | "pinch";
export type IndexPose = "extended" | "curled" | "pinch";
export type FingerPose = "extended" | "curled";

export interface HandPose {
  thumb: ThumbPose;
  index: IndexPose;
  middle: FingerPose;
  ring: FingerPose;
  pinky: FingerPose;
}

export interface PlaceOptions {
  /** 손목 위치 (정규화 이미지 좌표) */
  wrist?: { x: number; y: number };
  /** 손목→중지 MCP 길이 (정규화) */
  scale?: number;
  /** 화면 평면 회전 (rad, 반시계) */
  roll?: number;
  /** 좌우 반전 (반대 손) */
  mirror?: boolean;
  /** 좌표 잡음 표준편차 (정규화) */
  jitter?: number;
  seed?: number;
}

export const POSES = {
  OPEN_PALM: { thumb: "extended", index: "extended", middle: "extended", ring: "extended", pinky: "extended" },
  FIST: { thumb: "folded", index: "curled", middle: "curled", ring: "curled", pinky: "curled" },
  PINCH: { thumb: "pinch", index: "pinch", middle: "curled", ring: "curled", pinky: "curled" },
  PINCH_OK: { thumb: "pinch", index: "pinch", middle: "extended", ring: "extended", pinky: "extended" },
  POINT: { thumb: "folded", index: "extended", middle: "curled", ring: "curled", pinky: "curled" },
  PEACE: { thumb: "folded", index: "extended", middle: "extended", ring: "curled", pinky: "curled" },
} satisfies Record<string, HandPose>;

type V3 = [number, number, number];

// 손 좌표계: 손목 원점, y 위쪽, 손목→중지 MCP = 1
const MCP: Record<"index" | "middle" | "ring" | "pinky", [number, number]> = {
  index: [-0.27, 0.95],
  middle: [0, 1],
  ring: [0.25, 0.93],
  pinky: [0.47, 0.8],
};

const SEG = [0.45, 0.3, 0.25];

function dirOf([x, y]: [number, number]): [number, number] {
  const l = Math.hypot(x, y);
  return [x / l, y / l];
}

function rot([x, y]: [number, number], a: number): [number, number] {
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
}

function fingerChain(name: keyof typeof MCP, pose: IndexPose | FingerPose): V3[] {
  const m = MCP[name];
  const d = dirOf(m);
  const mcp: V3 = [m[0], m[1], 0];
  if (pose === "extended") {
    const pip: V3 = [mcp[0] + d[0] * SEG[0]!, mcp[1] + d[1] * SEG[0]!, 0];
    const dip: V3 = [pip[0] + d[0] * SEG[1]!, pip[1] + d[1] * SEG[1]!, 0];
    const tip: V3 = [dip[0] + d[0] * SEG[2]!, dip[1] + d[1] * SEG[2]!, 0];
    return [mcp, pip, dip, tip];
  }
  if (pose === "curled") {
    const pip: V3 = [mcp[0] + d[0] * 0.4, mcp[1] + d[1] * 0.4, -0.1];
    const dip: V3 = [pip[0] - d[0] * 0.15, pip[1] - d[1] * 0.15, -0.3];
    const tip: V3 = [dip[0] - d[0] * 0.2, dip[1] - d[1] * 0.2, -0.35];
    return [mcp, pip, dip, tip];
  }
  // pinch: 엄지 쪽(반시계)으로 점점 굽힘
  const pip: V3 = [mcp[0] + d[0] * 0.42, mcp[1] + d[1] * 0.42, -0.05];
  const d2 = rot(d, (40 * Math.PI) / 180);
  const dip: V3 = [pip[0] + d2[0] * 0.25, pip[1] + d2[1] * 0.25, -0.1];
  const d3 = rot(d, (80 * Math.PI) / 180);
  const tip: V3 = [dip[0] + d3[0] * 0.2, dip[1] + d3[1] * 0.2, -0.12];
  return [mcp, pip, dip, tip];
}

function thumbChain(pose: ThumbPose): V3[] {
  const cmc: V3 = [-0.3, 0.25, 0];
  if (pose === "extended") return [cmc, [-0.55, 0.5, 0], [-0.78, 0.72, 0], [-1.0, 0.92, 0]];
  if (pose === "folded") return [cmc, [-0.45, 0.5, -0.05], [-0.35, 0.75, -0.1], [-0.1, 0.7, -0.15]];
  return [cmc, [-0.5, 0.55, -0.03], [-0.65, 0.95, -0.08], [-0.75, 1.4, -0.12]];
}

/** 손 좌표계의 21개 점 */
export function handSpace(pose: HandPose): V3[] {
  return [
    [0, 0, 0],
    ...thumbChain(pose.thumb),
    ...fingerChain("index", pose.index),
    ...fingerChain("middle", pose.middle),
    ...fingerChain("ring", pose.ring),
    ...fingerChain("pinky", pose.pinky),
  ];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 손 좌표계 → 정규화 이미지 좌표 (y 아래쪽). */
export function syntheticHand(pose: HandPose, opts: PlaceOptions = {}): Landmark[] {
  const { wrist = { x: 0.5, y: 0.78 }, scale = 0.2, roll = 0, mirror = false, jitter = 0, seed = 1 } = opts;
  const rand = mulberry32(seed);
  const noise = () => (jitter ? (rand() + rand() + rand() - 1.5) * jitter * 2 : 0);
  return handSpace(pose).map(([hx, hy, hz]) => {
    const x0 = mirror ? -hx : hx;
    const [rx, ry] = rot([x0, hy], roll);
    return {
      x: wrist.x + rx * scale + noise(),
      y: wrist.y - ry * scale + noise(),
      z: hz * scale,
    };
  });
}
