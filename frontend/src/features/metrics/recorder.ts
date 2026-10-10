// 제스처 데이터 녹화 (D-008). 랜드마크만 저장하고 영상 프레임은 저장하지 않는다.

import type { HandFrame } from "../hand-tracking/types";
import type { GestureType } from "../gestures/types";

export type Lighting = "bright" | "normal" | "dim";

export interface RecordMeta {
  subject_id: string;
  lighting: Lighting;
  label: GestureType;
}

export interface RecordedFrame {
  /** 녹화 시작 기준 ms */
  t: number;
  /** 손이 없으면 null */
  landmarks: [number, number, number][] | null;
  handedness: "left" | "right" | null;
  handedness_score: number;
}

export interface GestureRecord extends RecordMeta {
  schema: "holoforge.gesture-record.v1";
  source: "webcam" | "synthetic";
  recorded_at: string;
  duration_ms: number;
  fps: number;
  frames: RecordedFrame[];
}

export const SUBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;

export class LandmarkRecorder {
  private frames: RecordedFrame[] = [];
  private startedAt = 0;
  private meta: RecordMeta | null = null;

  constructor(private readonly durationMs = 2000) {}

  get recording(): boolean {
    return this.meta !== null;
  }

  start(meta: RecordMeta, now: number): void {
    if (!SUBJECT_ID_PATTERN.test(meta.subject_id)) throw new Error("피험자 ID는 영문·숫자·_- 1~16자");
    this.meta = meta;
    this.startedAt = now;
    this.frames = [];
  }

  /** 프레임을 추가한다. 녹화 시간이 끝나면 완성된 레코드를 반환한다. */
  push(frame: HandFrame | null, now: number): GestureRecord | null {
    if (!this.meta) return null;
    const t = now - this.startedAt;
    if (t > this.durationMs) return this.finish();
    const round = (v: number) => Math.round(v * 1e5) / 1e5;
    this.frames.push({
      t: Math.round(t),
      landmarks: frame ? frame.landmarks.map((p) => [round(p.x), round(p.y), round(p.z)]) : null,
      handedness: frame?.handedness ?? null,
      handedness_score: frame ? round(frame.confidence) : 0,
    });
    return null;
  }

  private finish(): GestureRecord {
    const meta = this.meta!;
    this.meta = null;
    const span = this.frames.length > 1 ? this.frames.at(-1)!.t - this.frames[0]!.t : 0;
    return {
      schema: "holoforge.gesture-record.v1",
      source: "webcam",
      ...meta,
      recorded_at: new Date().toISOString(),
      duration_ms: this.durationMs,
      fps: span > 0 ? Math.round(((this.frames.length - 1) * 1000) / span) : 0,
      frames: this.frames,
    };
  }

  cancel(): void {
    this.meta = null;
    this.frames = [];
  }
}

export function toJsonl(records: GestureRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
}
