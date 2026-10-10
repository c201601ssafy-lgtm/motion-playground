import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { buildHandFrame } from "../src/features/gestures/features";
import { GesturePipeline } from "../src/features/gestures/pipeline";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";
import type { GestureEvent } from "../src/features/gestures/types";
import { LandmarkRecorder } from "../src/features/metrics/recorder";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const jsonl = (p: string) => read(p).split("\n").filter(Boolean).map((l) => JSON.parse(l));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateEvent = ajv.compile(JSON.parse(read("schemas/gesture-event.schema.json")));
const validateRecord = ajv.compile(JSON.parse(read("schemas/gesture-record.schema.json")));

describe("gesture-event.schema.json", () => {
  it("accepts every event the pipeline emits", () => {
    const p = new GesturePipeline();
    const events: GestureEvent[] = [];
    let t = 0;
    for (const pose of ["OPEN_PALM", "PINCH", "FIST"] as const) {
      for (let i = 0; i < 8; i++, t += 33) {
        events.push(...p.process(buildHandFrame(syntheticHand(POSES[pose]), "right", 0.9, t), t).events);
      }
    }
    for (let i = 0; i < 6; i++, t += 33) events.push(...p.process(null, t).events);
    expect(new Set(events.map((e) => e.phase))).toEqual(new Set(["start", "hold", "end"]));
    for (const e of events) expect(validateEvent(e), JSON.stringify(validateEvent.errors)).toBe(true);
  });

  it("accepts the committed sample and rejects malformed events", () => {
    for (const e of jsonl("evals/gesture-events-sample.jsonl")) expect(validateEvent(e)).toBe(true);
    const good = jsonl("evals/gesture-events-sample.jsonl")[0];
    expect(validateEvent({ ...good, type: "NONE" })).toBe(false);
    expect(validateEvent({ ...good, confidence: 2 })).toBe(false);
    expect(validateEvent({ ...good, extra: 1 })).toBe(false);
  });
});

describe("gesture-record.schema.json", () => {
  it("accepts recorder output", () => {
    const r = new LandmarkRecorder(60);
    r.start({ subject_id: "S01", lighting: "bright", label: "PINCH" }, 0);
    r.push(buildHandFrame(syntheticHand(POSES.PINCH), "left", 0.9, 0), 0);
    r.push(null, 33);
    const rec = r.push(null, 70)!;
    expect(validateRecord(rec), JSON.stringify(validateRecord.errors)).toBe(true);
  });

  it("accepts the committed synthetic records", () => {
    const recs = jsonl("evals/gesture-records-sample.jsonl");
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) expect(validateRecord(r)).toBe(true);
  });

  it("rejects records that smuggle in image data", () => {
    const rec = jsonl("evals/gesture-records-sample.jsonl")[0];
    expect(validateRecord({ ...rec, image: "data:image/png;base64,AAA" })).toBe(false);
  });
});
