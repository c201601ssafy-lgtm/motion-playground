import { describe, expect, it } from "vitest";
import type { Command } from "../src/features/commands/types";
import { buildHandFrame } from "../src/features/gestures/features";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";
import { bothPalmsOpen, TwoHandDetector } from "../src/features/gestures/twoHand";
import { pickPrimary } from "../src/features/hand-tracking/handTracker";

type PoseName = keyof typeof POSES;

/** 화면 중앙을 기준으로 좌우 대칭인 두 손 (sep: 손목 사이 거리, 정규화) */
function pair(sep: number, pose: PoseName = "OPEN_PALM", other: PoseName = pose, t = 0) {
  const left = buildHandFrame(syntheticHand(POSES[pose], { wrist: { x: 0.5 - sep / 2, y: 0.8 }, scale: 0.15 }), "left", 0.9, t);
  const right = buildHandFrame(
    syntheticHand(POSES[other], { wrist: { x: 0.5 + sep / 2, y: 0.8 }, scale: 0.15, mirror: true }),
    "right",
    0.9,
    t,
  );
  return [left, right];
}

/** sep 값을 차례로 33ms 간격으로 넣고 나온 명령을 모은다 */
function run(seps: number[], det = new TwoHandDetector(), start = 0, pose: PoseName = "OPEN_PALM") {
  const out: Command[] = [];
  seps.forEach((s, i) => {
    const c = det.update(pair(s, pose), start + i * 33);
    if (c) out.push(c);
  });
  return out;
}

const ramp = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

describe("TwoHandDetector (P5-7)", () => {
  it("두 손을 펼친 채 벌리면 분해(EXPLODE on)", () => {
    expect(run([...ramp(0.3, 0.3, 4), ...ramp(0.3, 0.6, 10)])).toEqual([{ type: "EXPLODE", on: true }]);
  });

  it("두 손을 모으면 전체 조립(ASSEMBLE_ALL)", () => {
    expect(run([...ramp(0.6, 0.6, 4), ...ramp(0.6, 0.3, 10)])).toEqual([{ type: "ASSEMBLE_ALL" }]);
  });

  it("두 손 다 펼치지 않으면(한 손 집기) 반응하지 않는다", () => {
    const det = new TwoHandDetector();
    const seps = [...ramp(0.3, 0.3, 4), ...ramp(0.3, 0.7, 10)];
    const out = seps.map((s, i) => det.update(pair(s, "OPEN_PALM", "PINCH"), i * 33)).filter(Boolean);
    expect(out).toEqual([]);
    expect(bothPalmsOpen(pair(0.4, "OPEN_PALM", "PINCH"))).toBe(false);
    expect(bothPalmsOpen(pair(0.4))).toBe(true);
  });

  it("천천히(창 1.5초보다 느리게) 벌리면 반응하지 않는다", () => {
    expect(run(ramp(0.3, 0.6, 150))).toEqual([]); // 5초에 걸쳐
  });

  it("손 떨림 정도로는 반응하지 않는다", () => {
    expect(run(Array.from({ length: 60 }, (_, i) => 0.4 + (i % 2 ? 0.02 : -0.02)))).toEqual([]);
  });

  it("한 번 낸 뒤 쿨다운 동안은 다시 내지 않는다", () => {
    const det = new TwoHandDetector();
    const first = run([...ramp(0.3, 0.3, 4), ...ramp(0.3, 0.6, 10)], det, 0);
    const again = run([...ramp(0.6, 0.3, 10)], det, 14 * 33);
    expect(first).toHaveLength(1);
    expect(again).toEqual([]);
  });

  it("손이 하나면 아무것도 하지 않는다", () => {
    const det = new TwoHandDetector();
    const one = buildHandFrame(syntheticHand(POSES.OPEN_PALM), "right", 0.9, 0);
    expect(det.update([one], 0)).toBeNull();
    expect(bothPalmsOpen([one])).toBe(false);
  });
});

describe("pickPrimary (손 2개일 때 주 손 고르기)", () => {
  it("직전 주 손과 가까운 손을 계속 고른다 (손 순서가 바뀌어도)", () => {
    const [left, right] = pair(0.4);
    const last = { x: right!.palm_center.x, y: right!.palm_center.y };
    expect(pickPrimary([left!, right!], last)).toBe(right);
    expect(pickPrimary([right!, left!], last)).toBe(right);
  });

  it("처음이거나 손이 하나면 첫 손", () => {
    const [left, right] = pair(0.4);
    expect(pickPrimary([left!, right!], null)).toBe(left);
    expect(pickPrimary([right!], { x: 0, y: 0 })).toBe(right);
    expect(pickPrimary([], null)).toBeNull();
  });
});
