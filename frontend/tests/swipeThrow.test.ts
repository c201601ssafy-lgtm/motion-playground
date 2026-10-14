import { expect, it } from "vitest";
import { swipeShot } from "../src/features/crumple/swipeThrow";

it("maps upward flick speed to power and lateral movement to direction", () => {
  const slow = swipeShot([{ x: 0, y: 1, at: 0 }, { x: 0, y: 0.8, at: 150 }])!;
  const fast = swipeShot([{ x: 0, y: 1, at: 0 }, { x: 0.1, y: 0.7, at: 100 }])!;
  expect(fast.power).toBeGreaterThan(slow.power);
  expect(fast.aim).toBeGreaterThan(0);
  expect(slow.aim).toBe(0);
});
it("rejects clicks, downward drags, and a swipe held still before release", () => {
  expect(swipeShot([{ x: 0, y: 1, at: 0 }, { x: 0, y: 1, at: 100 }])).toBeNull();
  expect(swipeShot([{ x: 0, y: 0, at: 0 }, { x: 0, y: 1, at: 100 }])).toBeNull();
  expect(swipeShot([{ x: 0, y: 1, at: 0 }, { x: 0, y: 0.5, at: 100 }, { x: 0, y: 0.5, at: 400 }])).toBeNull();
});
