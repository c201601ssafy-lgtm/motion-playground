import type { HandFrame, Landmark } from "../hand-tracking/types";
import type { PoseFrame } from "./poseTracking";

export type Game = "running" | "pot" | "archery" | "racing";
export const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const distance = (a: Landmark, b: Landmark, aspect = 1) => Math.hypot((a.x - b.x) * aspect, a.y - b.y, (a.z - b.z) * aspect);

export function fingerFlex(hand: HandFrame, ids: number[], aspect = 4 / 3): number {
  const p = ids.map((i) => hand.landmarks[i]!);
  const chain = distance(p[0]!, p[1]!, aspect) + distance(p[1]!, p[2]!, aspect) + distance(p[2]!, p[3]!, aspect);
  return chain > 1e-6 ? clamp((1 - distance(p[0]!, p[3]!, aspect) / chain) / 0.65) : 0;
}

export class RunningMotion {
  private down = [false, false];
  private lastFoot = -1;
  private lastStepAt = -Infinity;
  steps = 0;
  update(hand: HandFrame | null, now: number, threshold = 0.55, aspect = 4 / 3) {
    if (!hand || !Number.isFinite(hand.confidence) || hand.confidence < 0.6) { this.down = [false, false]; this.lastFoot = -1; return { flex: [0, 0], steps: this.steps, step: null, speed: 0 }; }
    const flex = [fingerFlex(hand, [5, 6, 7, 8], aspect), fingerFlex(hand, [9, 10, 11, 12], aspect)];
    if (flex.every((v) => v > threshold)) { this.down = [true, true]; return { flex, steps: this.steps, step: null, speed: 0 }; }
    let step: number | null = null;
    for (let i = 0; i < 2; i++) {
      if (flex[i]! < threshold * 0.55) this.down[i] = false;
      if (flex[i]! > threshold && !this.down[i]) {
        this.down[i] = true;
        if (i !== this.lastFoot && now - this.lastStepAt >= 100) { this.steps++; this.lastFoot = i; this.lastStepAt = now; step = i; }
      }
    }
    return { flex, steps: this.steps, step, speed: now - this.lastStepAt < 600 ? clamp(1 - (now - this.lastStepAt) / 600) : 0 };
  }
}

export function armObservation(frame: PoseFrame | null, side: "left" | "right", aspect = 4 / 3) {
  if (!frame) return null;
  const ids = side === "left" ? [11, 13, 15] : [12, 14, 16];
  const opposite = frame.points[side === "left" ? 12 : 11];
  const [shoulder, elbow, wrist] = ids.map((id) => frame.points[id]);
  if (!shoulder || !elbow || !wrist || !opposite || [shoulder, elbow, wrist, opposite].some((p) => p.visibility < 0.6 || !Number.isFinite(p.x + p.y + p.z))) return null;
  const width = Math.hypot((shoulder.x - opposite.x) * aspect, shoulder.y - opposite.y);
  if (width < 0.04) return null;
  const dx = (shoulder.x - wrist.x) * aspect / width, dy = (wrist.y - shoulder.y) / width;
  return { shoulder, elbow, wrist, width, dx, dy, angle: Math.atan2(dy, dx), reach: clamp(Math.hypot(dx, dy) / 2, 0, 1) };
}

export class PotMotion {
  private previous: number | null = null;
  private filtered: number | null = null;
  private neutral = 0;
  calibrate(angle: number) { this.neutral = angle; this.previous = null; this.filtered = null; }
  update(arm: ReturnType<typeof armObservation>, gain = 1) {
    if (!arm) { this.previous = null; this.filtered = null; return null; }
    const target = arm.angle - this.neutral;
    const wrap = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
    this.filtered = this.filtered === null ? target : this.filtered + wrap(target - this.filtered) * 0.35;
    const impulse = this.previous === null ? 0 : clamp(Math.abs(wrap(this.filtered - this.previous)) * gain, 0, 0.2);
    this.previous = this.filtered;
    return { angle: this.filtered, reach: arm.reach, impulse };
  }
}

export class ArcheryMotion {
  private armed = false;
  private closedSince: number | null = null;
  private openedSince: number | null = null;
  private base = 0;
  private maxPower = 0;
  calibrate(separation: number) { this.base = separation; this.reset(); }
  reset() { this.armed = false; this.closedSince = null; this.openedSince = null; this.maxPower = 0; }
  update(bow: ReturnType<typeof armObservation>, draw: ReturnType<typeof armObservation>, hand: HandFrame | null, now: number, threshold = 0.25, aspect = 4 / 3) {
    if (!bow || !draw || !hand || !Number.isFinite(hand.confidence) || hand.confidence < 0.6) { this.reset(); return null; }
    const separation = Math.hypot((bow.wrist.x - draw.wrist.x) * aspect, bow.wrist.y - draw.wrist.y) / bow.width;
    const power = clamp((separation - this.base - threshold) / 1.4);
    const fs = hand.finger_states;
    const open = fs.index && fs.middle && fs.ring && fs.pinky;
    const grip = Object.values(hand.finger_folded).every(Boolean) || (hand.pinch_distance < 0.5 && !hand.finger_folded.index);
    if (grip) {
      this.openedSince = null;
      this.closedSince ??= now;
      if (power > 0.1 && now - this.closedSince >= 150) { this.armed = true; this.maxPower = Math.max(this.maxPower, power); }
    } else if (open) {
      this.closedSince = null;
      this.openedSince ??= now;
    } else {
      this.closedSince = null; this.openedSince = null;
    }
    const shot = open && this.armed && now - this.openedSince! >= 120;
    const shotPower = this.maxPower;
    if (shot) this.reset();
    return { angle: bow.angle, power, separation, armed: this.armed, shot, shotPower };
  }
}
