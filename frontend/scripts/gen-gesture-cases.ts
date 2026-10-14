// evals/gesture-cases.jsonl 생성기. 실행: npm run gen:gesture-cases
// 합성 랜드마크 + 기대 특징/제스처. 프론트(TS)와 백엔드(Python) 분류기가 같은 결과를 내는지 검증하는 데 쓴다.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildHandFrame } from "../src/features/gestures/features";
import { classify } from "../src/features/gestures/ruleClassifier";
import { type HandPose, POSES, type PlaceOptions, syntheticHand } from "../src/features/gestures/synthetic";
import type { GestureType } from "../src/features/gestures/types";
import type { Landmark } from "../src/features/hand-tracking/types";
import { LM } from "../src/features/hand-tracking/types";

const LABEL: Record<keyof typeof POSES, GestureType> = {
  OPEN_PALM: "OPEN_PALM",
  FIST: "FIST",
  PINCH: "PINCH",
  PINCH_OK: "PINCH",
  POINT: "POINT",
  PEACE: "NONE",
};

const VARIANTS: { name: string; opts: PlaceOptions; aspect: number }[] = [
  { name: "center", opts: {}, aspect: 1 },
  { name: "small-left", opts: { wrist: { x: 0.25, y: 0.85 }, scale: 0.12 }, aspect: 1 },
  { name: "rolled-mirror", opts: { roll: 0.45, mirror: true, scale: 0.25 }, aspect: 1 },
  { name: "jitter", opts: { jitter: 0.002, seed: 7 }, aspect: 1 },
  // 4:3 영상: x 축이 압축된 좌표를 aspect=4/3로 보정
  { name: "aspect-4x3", opts: { scale: 0.18 }, aspect: 4 / 3 },
];

const round = (v: number) => Math.round(v * 1e6) / 1e6;

function squashX(lm: Landmark[], aspect: number): Landmark[] {
  if (aspect === 1) return lm;
  return lm.map((p) => ({ x: 0.5 + (p.x - 0.5) / aspect, y: p.y, z: p.z / aspect }));
}

/** 집기 상태에서 엄지 끝만 검지 끝으로부터 target(손 크기 배수)만큼 떨어뜨린다 (히스테리시스 검증용). */
function openPinch(target: number): Landmark[] {
  const lm = syntheticHand(POSES.PINCH);
  const tip = lm[LM.INDEX_TIP]!;
  const thumb = lm[LM.THUMB_TIP]!;
  const size = Math.hypot(lm[0]!.x - lm[9]!.x, lm[0]!.y - lm[9]!.y);
  const dx = thumb.x - tip.x;
  const dy = thumb.y - tip.y;
  const d = Math.hypot(dx, dy) || 1;
  lm[LM.THUMB_TIP] = { x: tip.x + (dx / d) * target * size, y: tip.y + (dy / d) * target * size, z: thumb.z };
  return lm;
}

interface Case {
  id: string;
  source: "synthetic";
  aspect: number;
  prev: GestureType;
  landmarks: number[][];
  expect: {
    gesture: GestureType;
    finger_states: Record<string, boolean>;
    finger_folded: Record<string, boolean>;
    pinch_distance: number;
  };
}

function makeCase(id: string, lm: Landmark[], aspect: number, prev: GestureType, label: GestureType): Case {
  const frame = buildHandFrame(lm, "right", 0.95, 0, aspect);
  const got = classify(frame, prev).type;
  if (got !== label) throw new Error(`${id}: 분류기 결과 ${got} ≠ 기대 ${label}`);
  return {
    id,
    source: "synthetic",
    aspect: round(aspect),
    prev,
    landmarks: lm.map((p) => [round(p.x), round(p.y), round(p.z)]),
    expect: {
      gesture: label,
      finger_states: frame.finger_states,
      finger_folded: frame.finger_folded,
      pinch_distance: round(frame.pinch_distance),
    },
  };
}

const cases: Case[] = [];
for (const [poseName, pose] of Object.entries(POSES) as [keyof typeof POSES, HandPose][]) {
  for (const v of VARIANTS) {
    const lm = squashX(syntheticHand(pose, v.opts), v.aspect);
    cases.push(makeCase(`${poseName.toLowerCase()}-${v.name}`, lm, v.aspect, "NONE", LABEL[poseName]));
  }
}
// 히스테리시스: 0.42는 PINCH 진입(0.35)엔 부족하지만 유지(0.5)엔 충분
cases.push(makeCase("pinch-hysteresis-enter-blocked", openPinch(0.42), 1, "NONE", "NONE"));
cases.push(makeCase("pinch-hysteresis-hold", openPinch(0.42), 1, "PINCH", "PINCH"));
cases.push(makeCase("pinch-hysteresis-release", openPinch(0.6), 1, "PINCH", "NONE"));

const out = fileURLToPath(new URL("../../evals/gesture-cases.jsonl", import.meta.url));
writeFileSync(out, cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
console.log(`wrote ${cases.length} cases → ${out}`);
