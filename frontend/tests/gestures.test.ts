import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildHandFrame } from "../src/features/gestures/features";
import { EmaFilter, NoFilter, OneEuroFilter, type Point3 } from "../src/features/gestures/filters";
import { GesturePipeline } from "../src/features/gestures/pipeline";
import { classify } from "../src/features/gestures/ruleClassifier";
import { GestureStateMachine } from "../src/features/gestures/stateMachine";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";
import type { Classification, GestureEvent, GestureType } from "../src/features/gestures/types";

interface Case {
  id: string;
  aspect: number;
  prev: GestureType;
  landmarks: number[][];
  expect: { gesture: GestureType; finger_states: object; finger_folded: object; pinch_distance: number };
}

const CASES: Case[] = readFileSync(new URL("../../evals/gesture-cases.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

describe("rule classifier (evals/gesture-cases.jsonl)", () => {
  it("has cases for every gesture", () => {
    const labels = new Set(CASES.map((c) => c.expect.gesture));
    expect([...labels].sort()).toEqual(["FIST", "NONE", "OPEN_PALM", "PINCH", "POINT"]);
  });

  it.each(CASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const lm = c.landmarks.map(([x, y, z]) => ({ x: x!, y: y!, z: z! }));
    const frame = buildHandFrame(lm, "right", 0.95, 0, c.aspect);
    expect(frame.finger_states).toEqual(c.expect.finger_states);
    expect(frame.finger_folded).toEqual(c.expect.finger_folded);
    expect(frame.pinch_distance).toBeCloseTo(c.expect.pinch_distance, 4);
    expect(classify(frame, c.prev).type).toBe(c.expect.gesture);
  });

  it("returns NONE without a hand", () => {
    expect(classify(null)).toEqual({ type: "NONE", confidence: 0 });
  });
});

const P: Point3 = { x: 0.5, y: 0.5, z: 0 };
const c = (type: GestureType, confidence = 0.9): Classification => ({ type, confidence });

function run(sm: GestureStateMachine, seq: (Classification | null)[], dt = 33, pos = () => P): GestureEvent[] {
  const out: GestureEvent[] = [];
  seq.forEach((cl, i) => out.push(...sm.update(cl, cl ? pos : null, 1000 + i * dt)));
  return out;
}

describe("GestureStateMachine", () => {
  it("needs minHoldFrames consecutive frames before start", () => {
    const sm = new GestureStateMachine();
    expect(run(sm, [c("PINCH"), c("PINCH")])).toEqual([]);
    const ev = run(sm, [c("PINCH")]);
    expect(ev.map((e) => `${e.type}:${e.phase}`)).toEqual(["PINCH:start"]);
  });

  it("ignores single-frame flickers", () => {
    const sm = new GestureStateMachine();
    const ev = run(sm, [c("PINCH"), c("FIST"), c("PINCH"), c("OPEN_PALM"), c("PINCH")]);
    expect(ev).toEqual([]);
  });

  it("ignores low-confidence frames", () => {
    const sm = new GestureStateMachine();
    expect(run(sm, [c("FIST", 0.3), c("FIST", 0.3), c("FIST", 0.3), c("FIST", 0.3)])).toEqual([]);
  });

  it("emits hold while active and end+start on switch, never duplicate start", () => {
    const sm = new GestureStateMachine();
    const seq = [...Array(5).fill(c("PINCH")), ...Array(5).fill(c("OPEN_PALM"))];
    const ev = run(sm, seq, 50).map((e) => `${e.type}:${e.phase}`);
    expect(ev.filter((e) => e === "PINCH:start")).toHaveLength(1);
    expect(ev).toEqual([
      "PINCH:start",
      "PINCH:hold",
      "PINCH:hold",
      "PINCH:hold", // OPEN_PALM 후보 1
      "PINCH:hold", // OPEN_PALM 후보 2
      "PINCH:end",
      "OPEN_PALM:start",
      "OPEN_PALM:hold",
      "OPEN_PALM:hold",
    ]);
  });

  it("respects switch cooldown", () => {
    const sm = new GestureStateMachine();
    // 1ms 간격이면 쿨다운(150ms) 때문에 두 번째 전환이 늦어진다
    const ev = run(sm, [...Array(3).fill(c("PINCH")), ...Array(3).fill(c("FIST"))], 1);
    expect(ev.map((e) => e.phase)).toEqual(["start", "hold", "hold", "hold"]);
  });

  it("ends the active gesture after the hand is lost for lostFrames", () => {
    const sm = new GestureStateMachine();
    run(sm, Array(3).fill(c("PINCH")));
    const ev = run(sm, [null, null, null, null, null]);
    expect(ev.map((e) => `${e.type}:${e.phase}`)).toEqual(["PINCH:end"]);
    expect(sm.current).toBe("NONE");
  });

  it("survives brief tracking dropouts without ending", () => {
    const sm = new GestureStateMachine();
    run(sm, Array(3).fill(c("PINCH")));
    const ev = run(sm, [null, null, c("PINCH")]);
    expect(ev.map((e) => e.phase)).toEqual(["hold"]);
  });

  it("freezes commands on unreliable frames and ends after sustained low confidence", () => {
    const sm = new GestureStateMachine();
    run(sm, Array(3).fill(c("PINCH")));
    expect(run(sm, [c("PINCH", 0.2), c("PINCH", NaN)])).toEqual([]);
    expect(run(sm, [c("PINCH")]).map((e) => e.phase)).toEqual(["hold"]);
    expect(run(sm, Array(5).fill(c("PINCH", 0.2))).map((e) => e.phase)).toEqual(["end"]);
  });

  it("reports delta between consecutive events", () => {
    const sm = new GestureStateMachine();
    let x = 0.5;
    const ev = run(sm, Array(5).fill(c("OPEN_PALM")), 33, () => ({ x: (x += 0.01), y: 0.5, z: 0 }));
    expect(ev[0]?.delta).toEqual({ x: 0, y: 0 });
    expect(ev[1]?.delta.x).toBeCloseTo(0.01);
  });
});

describe("filters", () => {
  function jitterVariance(f: { filter: (p: Point3, t: number) => Point3 }) {
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
    const xs: number[] = [];
    for (let i = 0; i < 200; i++) xs.push(f.filter({ x: 0.5 + rand(), y: 0.5, z: 0 }, i * 33).x);
    const tail = xs.slice(50);
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    return tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length;
  }

  it("EMA and One Euro reduce jitter variance on a still hand", () => {
    const raw = jitterVariance(new NoFilter());
    expect(jitterVariance(new EmaFilter())).toBeLessThan(raw * 0.5);
    expect(jitterVariance(new OneEuroFilter())).toBeLessThan(raw * 0.5);
  });

  it("One Euro lags less than EMA on fast motion", () => {
    const lag = (f: { filter: (p: Point3, t: number) => Point3 }) => {
      let last = 0;
      for (let i = 0; i < 30; i++) last = f.filter({ x: i * 0.02, y: 0, z: 0 }, i * 33).x;
      return 29 * 0.02 - last;
    };
    expect(lag(new OneEuroFilter())).toBeLessThan(lag(new EmaFilter(0.2)));
  });
});

describe("GesturePipeline", () => {
  const frame = (pose: keyof typeof POSES, t: number, x = 0.5) =>
    buildHandFrame(syntheticHand(POSES[pose], { wrist: { x, y: 0.78 } }), "right", 0.95, t);

  it("recognizes pointing and uses the index fingertip as the cursor", () => {
    const p = new GesturePipeline("none");
    for (let i = 0; i < 2; i++) expect(p.process(frame("POINT", i * 33), i * 33).events).toEqual([]);
    const f = frame("POINT", 66);
    const result = p.process(f, 66);
    expect(result.events[0]?.type).toBe("POINT");
    expect(result.events[0]?.position).toEqual(f.landmarks[8]);
    expect(result.events[0]?.phase).toBe("start");
  });

  it("turns a pinch sequence into start/hold events at the fingertip midpoint", () => {
    const p = new GesturePipeline("none");
    const events: GestureEvent[] = [];
    for (let i = 0; i < 6; i++) events.push(...p.process(frame("PINCH", i * 33), i * 33).events);
    expect(events[0]?.type).toBe("PINCH");
    expect(events[0]?.phase).toBe("start");
    // 손끝 중점은 손바닥 중심보다 위(작은 y)에 있다
    const palmY = frame("PINCH", 0).palm_center.y;
    expect(events[0]!.position.y).toBeLessThan(palmY);
    expect(events.slice(1).every((e) => e.phase === "hold")).toBe(true);
  });

  it("ends the gesture when the hand disappears", () => {
    const p = new GesturePipeline();
    for (let i = 0; i < 4; i++) p.process(frame("FIST", i * 33), i * 33);
    const ends = [];
    for (let i = 4; i < 12; i++) ends.push(...p.process(null, i * 33).events);
    expect(ends.map((e) => `${e.type}:${e.phase}`)).toEqual(["FIST:end"]);
  });

  it("keeps position smoothing through a brief tracking dropout", () => {
    const p = new GesturePipeline("ema");
    for (let i = 0; i < 4; i++) p.process(frame("OPEN_PALM", i * 33), i * 33);
    p.process(null, 132);
    const resumed = p.process(frame("OPEN_PALM", 165, 0.6), 165).events;
    expect(resumed[0]?.phase).toBe("hold");
    expect(resumed[0]?.delta.x).toBeCloseTo(0.035);
  });
});
