// 양손 제스처 (P5-7): 두 손을 펼친 채 벌리면 분해, 모으면 전체 조립. 키보드 E / A와 같은 명령을 낸다.
// 순수 로직이다. 손 프레임은 handFrameBus에서 받는다.

import type { Command } from "../commands/types";
import type { HandFrame } from "../hand-tracking/types";
import { classify } from "./ruleClassifier";

export const TWO_HAND_PARAMS = {
  /** 두 손이 함께 펼쳐진 채 이 프레임 수를 넘겨야 기준 거리를 잡는다 (우연히 스치는 손 무시) */
  holdFrames: 3,
  /** 기준 거리 대비 이 배율 이상으로 벌리면 분해 */
  spreadRatio: 1.5,
  /** 기준 거리 대비 이 배율 이하로 모으면 전체 조립 */
  squeezeRatio: 0.6,
  /** 기준을 잡은 뒤 이 시간 안에 벌리거나 모아야 한다. 넘기면 지금 거리로 기준을 다시 잡는다 (천천히 움직이는 손 무시) */
  windowMs: 1500,
  /** 한 번 낸 뒤 이 시간 동안은 다시 내지 않는다 */
  cooldownMs: 1500,
};

/** 두 손 모두 손바닥을 펼쳤는지 (이 동안 한 손 제스처는 멈춘다) */
export function bothPalmsOpen(hands: HandFrame[]): boolean {
  return hands.length >= 2 && hands.slice(0, 2).every((h) => classify(h).type === "OPEN_PALM");
}

/** 손바닥 중심 사이 거리를 두 손 크기 평균으로 나눈 값. 카메라와의 거리에 덜 민감하다. */
export function palmSeparation(a: HandFrame, b: HandFrame): number {
  const d = Math.hypot(a.palm_center.x - b.palm_center.x, a.palm_center.y - b.palm_center.y);
  return d / (((a.hand_size + b.hand_size) / 2) || 1e-6);
}

export class TwoHandDetector {
  private frames = 0;
  private base: { sep: number; at: number } | null = null;
  private cooldownUntil = 0;

  constructor(private readonly params = TWO_HAND_PARAMS) {}

  update(hands: HandFrame[], now: number): Command | null {
    if (!bothPalmsOpen(hands)) {
      this.frames = 0;
      this.base = null;
      return null;
    }
    const [a, b] = hands as [HandFrame, HandFrame];
    const sep = palmSeparation(a, b);
    this.frames++;
    if (this.frames < this.params.holdFrames || now < this.cooldownUntil) {
      this.base = null;
      return null;
    }
    if (!this.base || now - this.base.at > this.params.windowMs) {
      this.base = { sep, at: now };
      return null;
    }
    const ratio = sep / this.base.sep;
    let command: Command | null = null;
    if (ratio >= this.params.spreadRatio) command = { type: "EXPLODE", on: true };
    else if (ratio <= this.params.squeezeRatio) command = { type: "ASSEMBLE_ALL" };
    if (command) {
      this.cooldownUntil = now + this.params.cooldownMs;
      this.base = null;
    }
    return command;
  }

  reset(): void {
    this.frames = 0;
    this.base = null;
    this.cooldownUntil = 0;
  }
}
