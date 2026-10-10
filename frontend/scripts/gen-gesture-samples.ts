// 스키마 검증·평가용 샘플 생성. 실행: npm run gen:gesture-samples
// - evals/gesture-events-sample.jsonl  : 파이프라인이 낸 GestureEvent (schemas/gesture-event.schema.json)
// - evals/gesture-records-sample.jsonl : 합성 녹화 클립 (schemas/gesture-record.schema.json, source=synthetic)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildHandFrame } from "../src/features/gestures/features";
import { GesturePipeline } from "../src/features/gestures/pipeline";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";
import type { GestureEvent, GestureType } from "../src/features/gestures/types";
import type { GestureRecord, Lighting } from "../src/features/metrics/recorder";

const out = (name: string) => fileURLToPath(new URL(`../../evals/${name}`, import.meta.url));
const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

// 1) 이벤트 샘플: 펼침 → 집기(이동) → 주먹 → 손 사라짐
const pipeline = new GesturePipeline("one-euro");
const events: GestureEvent[] = [];
const script: [keyof typeof POSES | null, number][] = [
  ["OPEN_PALM", 12],
  ["PINCH", 15],
  ["FIST", 8],
  [null, 8],
];
let t = 0;
for (const [pose, n] of script) {
  for (let i = 0; i < n; i++, t += 33) {
    const frame = pose
      ? buildHandFrame(syntheticHand(POSES[pose], { wrist: { x: 0.45 + i * 0.005, y: 0.8 }, jitter: 0.001, seed: t }), "right", 0.95, t)
      : null;
    events.push(...pipeline.process(frame, t).events);
  }
}
writeFileSync(out("gesture-events-sample.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");

// 2) 합성 녹화 클립
const LABEL_POSES: Record<GestureType, (keyof typeof POSES)[]> = {
  OPEN_PALM: ["OPEN_PALM"],
  PINCH: ["PINCH", "PINCH_OK"],
  FIST: ["FIST"],
  NONE: ["POINT", "PEACE"],
};
const SUBJECTS = [
  { id: "syn01", opts: { scale: 0.18 } },
  { id: "syn02", opts: { scale: 0.13, roll: 0.35 } },
  { id: "syn03", opts: { scale: 0.22, roll: -0.3, mirror: true } },
];
const LIGHTING: { name: Lighting; jitter: number }[] = [
  { name: "bright", jitter: 0.0015 },
  { name: "normal", jitter: 0.003 },
  { name: "dim", jitter: 0.006 },
];
const records: GestureRecord[] = [];
let seed = 1;
for (const [label, poses] of Object.entries(LABEL_POSES) as [GestureType, (keyof typeof POSES)[]][]) {
  for (const subj of SUBJECTS) {
    for (const light of LIGHTING) {
      const pose = poses[seed % poses.length]!;
      const frames = Array.from({ length: 30 }, (_, i) => {
        // 어두운 조건에서는 가끔 손을 놓친다
        const lost = light.name === "dim" && i % 13 === 7;
        const lm = syntheticHand(POSES[pose], {
          ...subj.opts,
          wrist: { x: 0.5 + Math.sin(i / 6) * 0.03, y: 0.8 },
          jitter: light.jitter,
          seed: seed * 1000 + i,
        });
        return {
          t: i * 33,
          landmarks: lost ? null : lm.map((p) => [r5(p.x), r5(p.y), r5(p.z)] as [number, number, number]),
          handedness: lost ? null : ("right" as const),
          handedness_score: lost ? 0 : 0.95,
        };
      });
      records.push({
        schema: "holoforge.gesture-record.v1",
        source: "synthetic",
        subject_id: subj.id,
        lighting: light.name,
        label,
        recorded_at: "2026-10-11T00:00:00.000Z",
        duration_ms: 1000,
        fps: 30,
        frames,
      });
      seed++;
    }
  }
}
writeFileSync(out("gesture-records-sample.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`events ${events.length}, records ${records.length}`);
