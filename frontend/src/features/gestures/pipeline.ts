// HandFrame → 분류 → 상태 머신 → (확정된 제스처 기준점) 위치 필터 → GestureEvent.

import type { HandFrame } from "../hand-tracking/types";
import { LM } from "../hand-tracking/types";
import { createFilter, type FilterName, type Point3, type PointFilter } from "./filters";
import { classify } from "./ruleClassifier";
import { GestureStateMachine } from "./stateMachine";
import type { Classification, GestureEvent, GestureType } from "./types";

type ControlKind = "pinch" | "palm";

/** 집기는 엄지·검지 끝 중점, 그 외는 손바닥 중심을 위치로 쓴다. */
export function controlPoint(frame: HandFrame, kind: ControlKind): Point3 {
  if (kind === "pinch") {
    const a = frame.landmarks[LM.THUMB_TIP]!;
    const b = frame.landmarks[LM.INDEX_TIP]!;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  }
  return frame.palm_center;
}

export interface PipelineResult {
  classification: Classification;
  events: GestureEvent[];
}

export class GesturePipeline {
  readonly machine = new GestureStateMachine();
  private filter: PointFilter;
  private kind: ControlKind | null = null;

  constructor(filterName: FilterName = "one-euro") {
    this.filter = createFilter(filterName);
  }

  get filterName(): FilterName {
    return this.filter.name;
  }

  setFilter(name: FilterName): void {
    this.filter = createFilter(name);
    this.kind = null;
  }

  process(frame: HandFrame | null, now: number): PipelineResult {
    const classification = classify(frame, this.machine.current);
    if (!frame) {
      this.filter.reset();
      this.kind = null;
      return { classification, events: this.machine.update(null, null, now) };
    }
    // 쉬다가 새 제스처가 시작되면 오래된 필터 이력을 쓰지 않는다
    if (this.machine.current === "NONE") this.kind = null;
    const positionOf = (type: GestureType): Point3 => {
      const kind: ControlKind = type === "PINCH" ? "pinch" : "palm";
      // 기준점이 바뀌면(손바닥 ↔ 손끝) 이전 이력을 섞지 않도록 필터를 다시 시작
      if (kind !== this.kind) {
        this.filter.reset();
        this.kind = kind;
      }
      return this.filter.filter(controlPoint(frame, kind), now);
    };
    const events = this.machine.update(classification, positionOf, now);
    for (const e of events) e.roll = frame.roll_deg;
    return { classification, events };
  }

  reset(): void {
    this.machine.reset();
    this.filter.reset();
    this.kind = null;
  }
}
