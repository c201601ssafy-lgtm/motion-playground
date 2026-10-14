import { describe, expect, it } from "vitest";
import { CrumpleGesture, crumpledVertex } from "../src/features/crumple/crumpleGesture";
import { buildHandFrame } from "../src/features/gestures/features";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";

const pair = (gap: number, folded = false) => [
  buildHandFrame(syntheticHand(folded ? POSES.FIST : POSES.OPEN_PALM, { wrist: { x: 0.5 - gap / 2, y: 0.8 }, scale: 0.12 }), "left", 0.95, 0),
  buildHandFrame(syntheticHand(folded ? POSES.FIST : POSES.OPEN_PALM, { wrist: { x: 0.5 + gap / 2, y: 0.8 }, scale: 0.12 }), "right", 0.95, 0),
];

describe("crumple-to-close gesture", () => {
  it("requires spread open hands before accepting a squeeze and fold", () => {
    const m = new CrumpleGesture();
    m.observe(pair(0.08, true), 0); expect(m.tick(0).progress).toBe(0);
    m.observe(pair(0.6), 100); m.observe(pair(0.6), 400);
    expect(m.tick(400).armed).toBe(true);
    m.observe(pair(0.09, true), 450); expect(m.tick(450).closed).toBe(false);
    m.observe(pair(0.09, true), 650); expect(m.tick(650).closed).toBe(true);
    expect(m.tick(1000).progress).toBe(1);
  });
  it("does not close for open hands approaching or a tracking dropout", () => {
    const m = new CrumpleGesture();
    m.observe(pair(0.6), 0); m.observe(pair(0.6), 300);
    m.observe(pair(0.09), 350); m.observe(pair(0.09), 600);
    expect(m.tick(600).closed).toBe(false);
    m.observe(pair(0.09, true), 650); m.observe([], 700);
    expect(m.tick(1100).closed).toBe(false);
    expect(m.tick(1100).armed).toBe(true);
    expect(m.tick(1700).progress).toBe(0);
  });
  it("accepts a cupped grip before the palms overlap", () => {
    const m = new CrumpleGesture();
    m.observe(pair(0.6), 0); m.observe(pair(0.6), 300);
    const cupped = pair(0.3).map(h => ({ ...h,
      finger_states: { ...h.finger_states, index: false, middle: false },
      finger_folded: { index: false, middle: false, ring: false, pinky: false },
    }));
    m.observe(cupped, 350); m.observe(cupped, 510);
    expect(m.tick(510).closed).toBe(true);
  });
  it("pauses confirmation during overlap and resumes on fresh two-hand evidence", () => {
    const m = new CrumpleGesture();
    m.observe(pair(0.6), 0); m.observe(pair(0.6), 300);
    m.observe(pair(0.2, true), 350); m.observe(pair(0.2, true), 420);
    const progress = m.tick(420).progress;
    m.observe(pair(0.2, true).slice(0, 1), 450);
    expect(m.tick(700).progress).toBe(progress);
    expect(m.tick(700).closed).toBe(false);
    m.observe(pair(0.2, true), 750);
    expect(m.tick(750).closed).toBe(false);
    m.observe(pair(0.2, true), 830);
    expect(m.tick(830).closed).toBe(true);
  });
  it("reverses the deformation when hands reopen before commitment", () => {
    const m = new CrumpleGesture();
    m.observe(pair(0.6), 0); m.observe(pair(0.6), 300);
    m.observe(pair(0.2, true), 400);
    const folded = m.tick(400).progress;
    m.observe(pair(0.6), 450);
    expect(m.tick(450).progress).toBeLessThan(folded);
    expect(m.tick(450).closed).toBe(false);
  });
});

describe("paper geometry", () => {
  it("starts flat, folds in depth, and contracts into a small finite ball", () => {
    expect(crumpledVertex(2.5, 1.5, 0)).toEqual([2.5, 1.5, 0]);
    expect(Math.abs(crumpledVertex(2.5, 1.5, 0.5)[2])).toBeGreaterThan(0.01);
    for (let x = -2.75; x <= 2.75; x += 0.25) for (let y = -1.8; y <= 1.8; y += 0.2) {
      const p = crumpledVertex(x, y, 1);
      expect(p.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...p)).toBeLessThan(0.6);
    }
  });
});
