import { describe, expect, it } from "vitest";
import { buildHandFrame } from "../src/features/gestures/features";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";
import { SteeringController, wheelObservation } from "../src/features/racing/steering";

function pair(angle = 0, open = false, aspect = 4 / 3, x = 0, y = 0) {
  const dy = Math.tan(angle * Math.PI / 180) * 0.4 * aspect;
  return [
    buildHandFrame(syntheticHand(open ? POSES.OPEN_PALM : POSES.FIST, { wrist: { x: 0.7 + x, y: 0.5 + y - dy / 2 }, scale: 0.12 }), "left", 0.95, 0, aspect),
    buildHandFrame(syntheticHand(open ? POSES.OPEN_PALM : POSES.FIST, { wrist: { x: 0.3 + x, y: 0.5 + y + dy / 2 }, scale: 0.12 }), "right", 0.95, 0, aspect),
  ];
}

function ready(neutral = 0) {
  const c = new SteeringController();
  c.calibrate();
  for (let t = 0; t <= 600; t += 50) { c.observe(pair(neutral), t); c.step(t); }
  return c;
}

describe("racing wheel recognition", () => {
  it("matches clockwise screen steering, irrespective of detection order and translation", () => {
    const hands = pair(20);
    expect(wheelObservation(hands)?.angle).toBeCloseTo(20);
    expect(wheelObservation(hands.reverse())?.angle).toBeCloseTo(20);
    expect(wheelObservation(pair(-20, false, 4 / 3, 0.05, 0.08))?.angle).toBeCloseTo(-20);
  });

  it("corrects the camera aspect and uses wrists regardless of finger shape", () => {
    for (const aspect of [1, 4 / 3, 16 / 9]) {
      expect(wheelObservation(pair(25, false, aspect), aspect)?.angle).toBeCloseTo(25);
      expect(wheelObservation(pair(25, true, aspect), aspect)?.angle).toBeCloseTo(25);
    }
  });

  it("requires stable calibration before accelerating and compensates a tilted neutral", () => {
    const c = new SteeringController();
    c.observe(pair(), 0);
    expect(c.step(100).speed).toBe(0);
    c.calibrate();
    for (let t = 150; t < 600; t += 50) { c.observe(pair(10), t); expect(c.step(t).status).toBe("calibrating"); }
    c.observe(pair(10), 650);
    const calibrated = c.step(650);
    expect(calibrated.status).toBe("ready");
    expect(calibrated.steering).toBe(0);
  });

  it("brakes while preserving steering and accelerates after closing the hands", () => {
    const c = ready();
    for (let t = 650; t <= 2000; t += 50) { c.observe(pair(20), t); c.step(t); }
    const before = c.step(2000).speed;
    for (let t = 2050; t <= 2500; t += 50) { c.observe(pair(20, true), t); c.step(t); }
    const braking = c.step(2500);
    expect(braking.brake).toBe(true);
    expect(braking.steering).toBeGreaterThan(0.5);
    expect(braking.speed).toBeLessThan(before);
    for (let t = 2550; t <= 3500; t += 50) { c.observe(pair(20), t); c.step(t); }
    expect(c.step(3500).brake).toBe(false);
    expect(c.step(3500).speed).toBeGreaterThan(braking.speed);
  });

  it("rejects low confidence, a single hand, crossed or very close wrists", () => {
    const hands = pair();
    hands[0]!.confidence = 0.2;
    expect(wheelObservation(hands)).toBeNull();
    expect(wheelObservation([pair()[0]!])).toBeNull();
    const close = pair();
    close[0]!.landmarks[0]!.x = 0.31;
    expect(wheelObservation(close)).toBeNull();
    expect(wheelObservation(pair(80))).toBeNull();
  });

  it("does not mistake a one-frame open-hand flicker for a brake", () => {
    const c = ready();
    c.observe(pair(0, true), 650);
    expect(c.step(650).brake).toBe(false);
    c.observe(pair(), 700);
    expect(c.step(700).brake).toBe(false);
  });

  it("holds steering during a short dropout then stops even when camera frames cease", () => {
    const c = ready();
    for (let t = 650; t <= 1200; t += 50) { c.observe(pair(20), t); c.step(t); }
    const angle = c.step(1200).angle;
    c.observe([], 1250);
    expect(c.step(1250).angle).toBeCloseTo(angle);
    expect(c.step(1500).status).toBe("lost");
    expect(c.step(1500).brake).toBe(true);
    expect(c.step(2250).status).toBe("paused");
    expect(c.step(2250).speed).toBe(0);
  });

  it("applies the dead zone and saturates maximum steering", () => {
    const c = ready();
    for (let t = 650; t <= 1200; t += 50) { c.observe(pair(3), t); c.step(t); }
    expect(c.step(1200).steering).toBe(0);
    for (let t = 1250; t <= 2400; t += 50) { c.observe(pair(50), t); c.step(t); }
    expect(c.step(2400).steering).toBeCloseTo(1, 4);
  });
});
