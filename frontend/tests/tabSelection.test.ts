import { expect, it } from "vitest";
import { TabSelectionGesture } from "../src/features/crumple/tabSelection";
import { buildHandFrame } from "../src/features/gestures/features";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";

const hand = (pinch: number) => ({ ...buildHandFrame(syntheticHand(POSES.OPEN_PALM), "right", 0.95, 0),
  pinch_distance: pinch, finger_states: { thumb: true, index: true, middle: false, ring: false, pinky: false } });
it("keeps the pointed card when the index moves during pinching and selects once", () => {
  const g = new TabSelectionGesture();
  g.observe(hand(0.8), 7, 0); g.observe(hand(0.8), 7, 120);
  expect(g.observe(hand(0.2), 8, 150)).toBeNull();
  expect(g.observe(hand(0.2), 8, 240)).toBe(7);
  expect(g.observe(hand(0.2), 8, 270)).toBeNull();
});
it("requires a deliberate point and ignores stale targets after tracking loss", () => {
  const g = new TabSelectionGesture();
  expect(g.observe(hand(0.2), 7, 0)).toBeNull();
  g.observe(hand(0.8), 7, 100); g.observe(hand(0.8), 7, 220);
  g.observe(undefined, null, 300);
  expect(g.observe(hand(0.2), 7, 800)).toBeNull();
  expect(g.observe(hand(0.2), 7, 900)).toBeNull();
});
it("does not transfer a locked target to the other hand", () => {
  const g = new TabSelectionGesture();
  g.observe(hand(0.8), 7, 0); g.observe(hand(0.8), 7, 120);
  const left = { ...hand(0.2), handedness: "left" as const };
  expect(g.observe(left, 7, 150)).toBeNull();
  expect(g.observe(left, 7, 240)).toBeNull();
});
