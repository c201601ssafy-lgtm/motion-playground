import { describe, expect, it } from "vitest";
import { buildHandFrame } from "../src/features/gestures/features";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";
import { LatencyTracker, percentile, RingBuffer } from "../src/features/metrics/latency";
import { LandmarkRecorder, toJsonl } from "../src/features/metrics/recorder";

describe("latency", () => {
  it("computes nearest-rank percentiles", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile([], 50)).toBeNull();
  });

  it("ring buffer keeps only the latest values", () => {
    const b = new RingBuffer(3);
    [1, 2, 3, 4, 5].forEach((v) => b.push(v));
    expect(b.values().sort()).toEqual([3, 4, 5]);
  });

  it("tracker ignores invalid samples and reports per stage", () => {
    const t = new LatencyTracker();
    t.record("landmark", 10);
    t.record("landmark", 20);
    t.record("landmark", Number.NaN);
    t.record("gesture", -1);
    const s = t.stats();
    expect(s.landmark).toEqual({ p50: 10, p95: 20, n: 2 });
    expect(s.gesture.n).toBe(0);
  });
});

describe("LandmarkRecorder", () => {
  const frame = (t: number) => buildHandFrame(syntheticHand(POSES.FIST), "right", 0.9, t);

  it("records landmarks for the duration and returns a record with metadata", () => {
    const r = new LandmarkRecorder(100);
    r.start({ subject_id: "S01", lighting: "normal", label: "FIST" }, 1000);
    let rec = null;
    for (let t = 1000; t <= 1150 && !rec; t += 33) rec = r.push(t === 1066 ? null : frame(t), t);
    expect(rec).not.toBeNull();
    expect(rec!.label).toBe("FIST");
    expect(rec!.schema).toBe("holoforge.gesture-record.v1");
    expect(rec!.frames).toHaveLength(4); // t=0,33,66,99
    expect(rec!.frames[2]!.landmarks).toBeNull(); // 손 없는 프레임도 기록
    expect(rec!.frames[0]!.landmarks).toHaveLength(21);
    expect(rec!.fps).toBe(30);
    expect(r.recording).toBe(false);
  });

  it("never stores image data, only numbers", () => {
    const r = new LandmarkRecorder(50);
    r.start({ subject_id: "S02", lighting: "dim", label: "PINCH" }, 0);
    r.push(frame(0), 0);
    const rec = r.push(frame(60), 60)!;
    const line = toJsonl([rec]);
    expect(line).not.toMatch(/data:image|base64/);
    expect(JSON.parse(line.trim()).subject_id).toBe("S02");
  });

  it("rejects identifying-looking subject ids", () => {
    const r = new LandmarkRecorder();
    expect(() => r.start({ subject_id: "홍길동 010-1234", lighting: "normal", label: "NONE" }, 0)).toThrow();
  });
});
