import { describe, expect, it } from "vitest";
import { buildHandFrame, fingerFolded, fingerStates, handRoll, pinchDistance } from "../src/features/gestures/features";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";

const ALL = { thumb: true, index: true, middle: true, ring: true, pinky: true };
const NONE = { thumb: false, index: false, middle: false, ring: false, pinky: false };

describe("hand features", () => {
  it("open palm: all fingers extended, nothing folded, wide pinch", () => {
    const lm = syntheticHand(POSES.OPEN_PALM);
    expect(fingerStates(lm)).toEqual(ALL);
    expect(Object.values(fingerFolded(lm)).some(Boolean)).toBe(false);
    expect(pinchDistance(lm)).toBeGreaterThan(0.8);
  });

  it("fist: nothing extended, four fingers folded", () => {
    const lm = syntheticHand(POSES.FIST);
    expect(fingerStates(lm)).toEqual(NONE);
    expect(fingerFolded(lm)).toEqual({ index: true, middle: true, ring: true, pinky: true });
  });

  it("pinch: thumb and index tips touch, index not folded", () => {
    const lm = syntheticHand(POSES.PINCH);
    expect(pinchDistance(lm)).toBeLessThan(0.2);
    expect(fingerFolded(lm).index).toBe(false);
  });

  it("is invariant to position, scale, roll and mirroring", () => {
    for (const opts of [
      { wrist: { x: 0.3, y: 0.9 }, scale: 0.12 },
      { scale: 0.3, roll: 0.5 },
      { mirror: true, roll: -0.4 },
    ]) {
      expect(fingerStates(syntheticHand(POSES.OPEN_PALM, opts))).toEqual(ALL);
      expect(fingerStates(syntheticHand(POSES.FIST, opts))).toEqual(NONE);
      expect(pinchDistance(syntheticHand(POSES.PINCH, opts))).toBeLessThan(0.2);
    }
  });

  it("corrects aspect ratio so hand size is measured in consistent units", () => {
    // 4:3 영상에서 x 좌표는 실제보다 압축되어 들어온다 → aspect로 되돌림
    const lm = syntheticHand(POSES.OPEN_PALM).map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.75 }));
    expect(fingerStates(lm, 4 / 3)).toEqual(ALL);
  });

  it("builds a HandFrame with spec fields", () => {
    const f = buildHandFrame(syntheticHand(POSES.OPEN_PALM), "right", 0.9, 123);
    expect(f.landmarks).toHaveLength(21);
    expect(f.hand_size).toBeCloseTo(0.2);
    expect(f.palm_center.y).toBeLessThan(0.78);
    expect(f.timestamp).toBe(123);
  });
});

describe("handRoll (P5-6)", () => {
  it("손가락이 위를 향하면 0°, 손을 기울이면 기운 만큼", () => {
    expect(handRoll(syntheticHand(POSES.OPEN_PALM))).toBeCloseTo(0, 5);
    const tilted = handRoll(syntheticHand(POSES.PINCH, { roll: Math.PI / 6 }));
    expect(Math.abs(tilted)).toBeCloseTo(30, 3);
  });

  it("손가락 모양이 바뀌어도(펼침→집기) 각도는 같다", () => {
    const a = handRoll(syntheticHand(POSES.OPEN_PALM, { roll: 0.4 }));
    const b = handRoll(syntheticHand(POSES.PINCH, { roll: 0.4 }));
    expect(b).toBeCloseTo(a, 5);
  });

  it("종횡비를 보정한다", () => {
    const lm = syntheticHand(POSES.OPEN_PALM, { roll: 0.5 });
    const squeezed = lm.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * (3 / 4) }));
    expect(handRoll(squeezed, 4 / 3)).toBeCloseTo(handRoll(lm), 5);
  });
});
