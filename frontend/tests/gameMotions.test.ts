import { describe, expect, it } from "vitest";
import { buildHandFrame } from "../src/features/gestures/features";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";
import { ArcheryMotion, armObservation, fingerFlex, PotMotion, RunningMotion } from "../src/features/motion-lab/motions";
import { demoFrames } from "../src/features/motion-lab/demo";

const hand = (index: "extended" | "curled", middle: "extended" | "curled") =>
  buildHandFrame(syntheticHand({ ...POSES.OPEN_PALM, index, middle }), "right", 0.95, 0);

describe("finger running", () => {
  it("does not count a fist with both fingers folded as walking", () => {
    const m = new RunningMotion();
    expect(m.update(hand("curled", "curled"), 0).steps).toBe(0);
    expect(m.update(hand("curled", "curled"), 200).steps).toBe(0);
  });
  it("maps two distinct fingers to alternating steps without repeated holds", () => {
    const m = new RunningMotion();
    expect(m.update(hand("curled", "extended"), 0).step).toBe(0);
    expect(m.update(hand("curled", "extended"), 150).step).toBeNull();
    m.update(hand("extended", "extended"), 200);
    expect(m.update(hand("curled", "extended"), 300).steps).toBe(1);
    expect(m.update(hand("extended", "curled"), 450).step).toBe(1);
    expect(m.steps).toBe(2);
    expect(m.update(null, 500).speed).toBe(0);
    expect(m.update(hand("curled", "extended"), 650).steps).toBe(3);
  });

  it("normalizes finger motion across size and palm movement", () => {
    const small = buildHandFrame(syntheticHand(POSES.FIST, { scale: 0.1 }), "right", 0.95, 0);
    const big = buildHandFrame(syntheticHand(POSES.FIST, { scale: 0.3, wrist: { x: 0.2, y: 0.4 } }), "right", 0.95, 0);
    expect(fingerFlex(small, [5, 6, 7, 8])).toBeCloseTo(fingerFlex(big, [5, 6, 7, 8]));
    expect(fingerFlex(hand("extended", "extended"), [5, 6, 7, 8])).toBeCloseTo(0);
  });
});

describe("arm hammer", () => {
  it("requires visible shoulder, elbow and wrist and resets motion on loss", () => {
    const pose = demoFrames("pot", 1000, "right").pose;
    const arm = armObservation(pose, "right");
    expect(arm).not.toBeNull();
    const m = new PotMotion();
    expect(m.update(arm)?.impulse).toBe(0);
    expect(m.update(arm ? { ...arm, angle: arm.angle + 0.3 } : null)?.impulse).toBeGreaterThan(0);
    m.update(null);
    expect(m.update(arm)?.impulse).toBe(0);
    expect(m.update(arm)?.impulse).toBe(0);
    pose.points[14]!.visibility = 0.2;
    expect(armObservation(pose, "right")).toBeNull();
  });

  it("handles wraparound without a full-turn impulse", () => {
    const arm = armObservation(demoFrames("pot", 0, "right").pose, "right")!;
    const m = new PotMotion();
    m.update({ ...arm, angle: Math.PI - 0.01 });
    expect(m.update({ ...arm, angle: -Math.PI + 0.01 })!.impulse).toBeLessThan(0.02);
  });
});

describe("archery draw and release", () => {
  const closed = buildHandFrame(syntheticHand(POSES.FIST), "right", 0.95, 0);
  const opened = buildHandFrame(syntheticHand(POSES.OPEN_PALM), "right", 0.95, 0);
  const pose = demoFrames("archery", 2800, "right").pose;
  const bow = armObservation(pose, "left")!, draw = armObservation(pose, "right")!;

  it("arms only after a sustained pull and fires once after deliberate opening", () => {
    const m = new ArcheryMotion();
    m.update(bow, draw, closed, 0);
    expect(m.update(bow, draw, closed, 100)!.armed).toBe(false);
    expect(m.update(bow, draw, closed, 200)!.armed).toBe(true);
    expect(m.update(bow, draw, opened, 250)!.shot).toBe(false);
    expect(m.update(bow, draw, opened, 400)!.shot).toBe(true);
    expect(m.update(bow, draw, opened, 600)!.shot).toBe(false);
  });

  it("does not fire when tracking is lost or when the hand merely opens without pulling", () => {
    const m = new ArcheryMotion();
    expect(m.update(bow, draw, opened, 0)!.shot).toBe(false);
    m.update(bow, draw, closed, 50); m.update(bow, draw, closed, 250);
    expect(m.update(null, draw, opened, 300)).toBeNull();
    expect(m.update(bow, draw, opened, 450)!.shot).toBe(false);
  });

  it("calibrates the initial gap so resting arms do not draw the bow", () => {
    const m = new ArcheryMotion();
    const gap = Math.hypot((bow.wrist.x - draw.wrist.x) * 4 / 3, bow.wrist.y - draw.wrist.y) / bow.width;
    m.calibrate(gap);
    expect(m.update(bow, draw, closed, 0)!.power).toBe(0);
  });
});

describe("synthetic game trials", () => {
  it("produces alternating running steps and archery shots through the actual recognizers", () => {
    const run = new RunningMotion(), archery = new ArcheryMotion();
    let shots = 0;
    for (let t = 0; t < 8000; t += 50) {
      const r = demoFrames("running", t, "right"); run.update(r.hands[0]!, t);
      const a = demoFrames("archery", t, "right");
      if (archery.update(armObservation(a.pose, "left"), armObservation(a.pose, "right"), a.hands[0]!, t)?.shot) shots++;
    }
    expect(run.steps).toBeGreaterThan(8);
    expect(shots).toBe(2);
  });
});
