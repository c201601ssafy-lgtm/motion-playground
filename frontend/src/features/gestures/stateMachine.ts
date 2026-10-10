// 제스처 상태 머신: 한 프레임 감지로 바로 명령을 내지 않는다 (spec §7).
// - 최소 유지 프레임, 신뢰도 임계값, 전환 쿨다운, 손 사라짐 유예, start 중복 방지.

import type { Point3 } from "./filters";
import type { Classification, GestureEvent, GestureType } from "./types";

export const STATE_MACHINE_PARAMS = {
  minHoldFrames: 3,
  minConfidence: 0.6,
  switchCooldownMs: 150,
  /** 손이 이 프레임 수만큼 연속으로 안 보이면 진행 중 제스처 종료 */
  lostFrames: 5,
};

export type StateMachineParams = typeof STATE_MACHINE_PARAMS;

export class GestureStateMachine {
  private active: GestureType = "NONE";
  private candidate: GestureType = "NONE";
  private candidateCount = 0;
  private lastSwitchAt = -Infinity;
  private missing = 0;
  private lastPos: Point3 | null = null;
  private lastConfidence = 0;

  constructor(private readonly params: StateMachineParams = STATE_MACHINE_PARAMS) {}

  get current(): GestureType {
    return this.active;
  }

  /**
   * @param c 이번 프레임 분류 결과 (손이 없으면 null)
   * @param positionOf 제스처별 위치(필터 적용 후). 전환이 결정된 뒤 해당 제스처로 한 번만 호출된다.
   */
  update(c: Classification | null, positionOf: ((type: GestureType) => Point3) | null, now: number): GestureEvent[] {
    const events: GestureEvent[] = [];

    if (!c || !positionOf) {
      this.missing++;
      this.candidate = "NONE";
      this.candidateCount = 0;
      if (this.active !== "NONE" && this.missing >= this.params.lostFrames) {
        events.push(this.event("end", this.lastPos ?? { x: 0, y: 0, z: 0 }, now));
        this.active = "NONE";
        this.lastSwitchAt = now;
      }
      return events;
    }
    this.missing = 0;

    const type = c.confidence >= this.params.minConfidence ? c.type : "NONE";
    if (type === this.candidate) this.candidateCount++;
    else {
      this.candidate = type;
      this.candidateCount = 1;
    }

    const canSwitch =
      this.candidate !== this.active &&
      this.candidateCount >= this.params.minHoldFrames &&
      now - this.lastSwitchAt >= this.params.switchCooldownMs;

    if (canSwitch) {
      if (this.active !== "NONE") events.push(this.event("end", this.lastPos ?? { x: 0, y: 0, z: 0 }, now));
      this.active = this.candidate;
      this.lastSwitchAt = now;
      this.lastConfidence = c.confidence;
      if (this.active !== "NONE") events.push(this.event("start", positionOf(this.active), now));
      return events;
    }

    if (this.active !== "NONE") {
      if (c.type === this.active) this.lastConfidence = c.confidence;
      events.push(this.event("hold", positionOf(this.active), now));
    }
    return events;
  }

  reset(): void {
    this.active = "NONE";
    this.candidate = "NONE";
    this.candidateCount = 0;
    this.lastSwitchAt = -Infinity;
    this.missing = 0;
    this.lastPos = null;
  }

  private event(phase: GestureEvent["phase"], pos: Point3, now: number): GestureEvent {
    const prev = phase === "start" || !this.lastPos ? pos : this.lastPos;
    const delta = { x: pos.x - prev.x, y: pos.y - prev.y };
    if (phase !== "end") this.lastPos = pos;
    return {
      type: this.active as Exclude<GestureType, "NONE">,
      phase,
      position: { ...pos },
      delta,
      confidence: this.lastConfidence,
      timestamp: now,
    };
  }
}
