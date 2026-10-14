import { describe, expect, it } from "vitest";
import { buildHandFrame } from "../src/features/gestures/features";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";
import { HandStabilizer } from "../src/features/hand-tracking/stabilizer";

const hand = (x: number, t: number) => buildHandFrame(
  syntheticHand(POSES.OPEN_PALM, { wrist: { x, y: 0.78 } }), "right", 0.95, t,
);

describe("HandStabilizer", () => {
  it("reduces still-hand landmark jitter before classification", () => {
    const s = new HandStabilizer();
    const raw: number[] = [], stable: number[] = [];
    for (let i = 0; i < 100; i++) {
      const h = hand(0.5 + (i % 2 ? 0.003 : -0.003), i * 33);
      const f = s.process([h], i * 33, 1)[0]!;
      if (i > 20) {
        raw.push(h.landmarks[8]!.x);
        stable.push(f.landmarks[8]!.x);
      }
      expect(f.finger_states).toEqual(h.finger_states);
    }
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(spread(stable)).toBeLessThan(spread(raw) * 0.6);
  });

  it("keeps two hands separate when detection order changes", () => {
    const s = new HandStabilizer();
    s.process([hand(0.2, 0), hand(0.8, 0)], 0, 1);
    const frames = s.process([hand(0.8, 33), hand(0.2, 33)], 33, 1);
    expect(frames[0]!.landmarks[0]!.x).toBeCloseTo(0.8);
    expect(frames[1]!.landmarks[0]!.x).toBeCloseTo(0.2);
  });

  it("preserves a short dropout but discards expired or reset history", () => {
    const s = new HandStabilizer();
    s.process([hand(0.5, 0)], 0, 1);
    expect(s.process([], 33, 1)).toEqual([]);
    expect(s.process([hand(0.51, 66)], 66, 1)[0]!.landmarks[0]!.x).toBeLessThan(0.51);
    expect(s.process([hand(0.52, 500)], 500, 1)[0]!.landmarks[0]!.x).toBe(0.52);
    s.reset();
    expect(s.process([hand(0.53, 533)], 533, 1)[0]!.landmarks[0]!.x).toBe(0.53);
  });

  it("does not interpolate a newly appearing distant hand", () => {
    const s = new HandStabilizer();
    s.process([hand(0.1, 0)], 0, 1);
    expect(s.process([hand(0.9, 33)], 33, 1)[0]!.landmarks[0]!.x).toBe(0.9);
  });
});
