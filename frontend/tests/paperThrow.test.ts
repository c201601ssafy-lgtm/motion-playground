import { describe, expect, it } from "vitest";
import { PaperThrow, BIN, flightPoint, basketballShot, SHOT_TIME } from "../src/features/crumple/paperThrow";
import { buildHandFrame } from "../src/features/gestures/features";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";

function hand(x: number, y: number, open = false, side: "left" | "right" = "right") {
  const f = buildHandFrame(syntheticHand(open ? POSES.OPEN_PALM : POSES.FIST), side, 0.95, 0);
  f.palm_center = { x, y, z: 0 };
  return f;
}

describe("paper throwing motion", () => {
  it("acquires a gripping hand, follows it and releases with its recent velocity", () => {
    const m = new PaperThrow(); m.begin();
    m.observe([hand(0.7, 0.6)], 0);
    m.observe([hand(0.68, 0.57)], 60);
    m.observe([hand(0.65, 0.52)], 120);
    expect(m.step(120).position[0]).toBeCloseTo(-0.9);
    m.observe([hand(0.58, 0.46, true)], 160);
    const thrown = m.step(160);
    expect(thrown.phase).toBe("flying");
    expect(thrown.velocity[0]).toBeGreaterThan(1);
    expect(thrown.velocity[1]).toBeGreaterThan(1);
    expect(m.step(400).position[0]).toBeGreaterThan(thrown.position[0]);
  });

  it("does not throw on slow opening, missing tracking or a different hand", () => {
    const m = new PaperThrow(); m.begin();
    m.observe([hand(0.6, 0.6)], 0); m.observe([hand(0.6, 0.6)], 70); m.observe([hand(0.6, 0.6)], 140);
    m.observe([hand(0.6, 0.6, true)], 180);
    expect(m.step(180).phase).toBe("holding");
    m.observe([hand(0.5, 0.5)], 240); m.observe([], 300);
    m.observe([hand(0.2, 0.2, true, "left")], 340);
    expect(m.step(340).phase).toBe("holding");
    m.observe([hand(0.3, 0.2, true)], 700);
    expect(m.step(700).phase).toBe("holding");
  });

  it("registers a ballistic rim entry even if rendering skips frames", () => {
    const m = new PaperThrow(); m.begin(); m.throwAtBin(100);
    expect(m.step(400).phase).toBe("flying");
    const result = m.step(1800);
    expect(result.phase).toBe("hit");
    expect(result.position[0]).toBe(BIN.x);
    expect(m.step(3000).phase).toBe("hit");
  });

  it("distinguishes a miss and allows picking the paper up again", () => {
    const m = new PaperThrow(); m.begin(); m.launch([-2, 1.5, -0.85], 0);
    expect(m.step(2000).phase).toBe("missed");
    expect(m.state.position).toEqual([0, 0, 0]);
    expect(m.state.velocity).toEqual([0, 0, 0]);
    expect(m.step(2500).phase).toBe("missed");
    expect(m.step(2600).phase).toBe("holding");
    m.throwAtBin(2700);
    expect(m.step(5200).phase).toBe("hit");
    expect(m.state.hand).toBeNull();
  });

  it("uses gravity and does not launch before paper exists", () => {
    expect(flightPoint([0, 0, 0], [1, 2, 0], 1)).toEqual([1, -0.75, 0]);
    const m = new PaperThrow(); m.throwAtBin(0);
    expect(m.state.phase).toBe("idle");
  });

  it("shoots down the court with a raised arc and a flight longer than the nearby toss", () => {
    expect(BIN.z).toBeLessThan(-4);
    expect(SHOT_TIME).toBeGreaterThan(1.2);
    const v = basketballShot([0, 0, 0]);
    expect(flightPoint([0, 0, 0], v, SHOT_TIME / 2)[1]).toBeGreaterThan(1);
    const landing = flightPoint([0, 0, 0], v, SHOT_TIME);
    expect(landing[0]).toBeCloseTo(BIN.x);
    expect(landing[1]).toBeCloseTo(BIN.y);
    expect(landing[2]).toBeCloseTo(BIN.z);
  });

  it("distinguishes short, long and sideways shots from a correctly powered shot", () => {
    for (const [power, aim] of [[0.7, 0], [1.3, 0], [1, 1]]) {
      const m = new PaperThrow(); m.begin(); m.throwAtBin(0, power!, aim!);
      expect(m.step(2500).phase).toBe("missed");
    }
    const good = new PaperThrow(); good.begin(); good.throwAtBin(0);
    expect(good.step(2500).phase).toBe("hit");
  });

  it("does not accept a sideways swipe without an upward shooting motion", () => {
    const m = new PaperThrow(); m.begin();
    m.observe([hand(0.7, 0.6)], 0); m.observe([hand(0.68, 0.6)], 60); m.observe([hand(0.65, 0.6)], 120);
    m.observe([hand(0.58, 0.6, true)], 160);
    expect(m.step(160).phase).toBe("holding");
  });
});
