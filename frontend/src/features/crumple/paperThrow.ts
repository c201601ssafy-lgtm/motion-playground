import type { HandFrame } from "../hand-tracking/types";

export type V3 = [number, number, number];
export const BIN = { x: 1.1, y: -0.25, z: -6, radius: 0.72 };
export const SHOT_TIME = 1.45;
const GRAVITY = 5.5;
export interface ThrowState { phase: "idle" | "holding" | "flying" | "hit" | "missed"; position: V3; velocity: V3; message: string; hand: string | null }
export function flightPoint(origin: V3, velocity: V3, time: number): V3 {
  return [origin[0] + velocity[0] * time, origin[1] + velocity[1] * time - 0.5 * GRAVITY * time * time, origin[2] + velocity[2] * time];
}

export function basketballShot(origin: V3, power = 1, aim = 0): V3 {
  const strength = Math.max(0.6, Math.min(1.4, power));
  return [(BIN.x - origin[0]) / SHOT_TIME * strength + aim * 0.9,
    (BIN.y - origin[1] + 0.5 * GRAVITY * SHOT_TIME ** 2) / SHOT_TIME * strength,
    (BIN.z - origin[2]) / SHOT_TIME * strength];
}

function gestureShot(origin: V3, vx: number, vy: number): V3 {
  // Webcam depth is noisy: an upward shooting motion sets forward force, lateral motion sets aim.
  return basketballShot(origin, Math.max(0.65, Math.min(1.3, 0.65 + Math.max(0, vy) * 0.13)), vx * 0.15);
}

export class PaperThrow {
  state: ThrowState = { phase: "idle", position: [0, 0, 0], velocity: [0, 0, 0], message: "", hand: null };
  private history: { at: number; position: V3 }[] = [];
  private gripSince: number | null = null;
  private lastSeen = -Infinity;
  private origin: V3 = [0, 0, 0];
  private launchedAt = 0;
  private missedAt = 0;

  begin() {
    this.state = { phase: "holding", position: [0, 0, 0], velocity: [0, 0, 0], message: "한 손으로 공을 잡고 위로 밀어 올리며 펼쳐 슛하세요 · 빠를수록 멀리 날아갑니다", hand: null };
    this.history = []; this.gripSince = null; this.lastSeen = -Infinity;
  }

  observe(hands: HandFrame[], now: number) {
    if (this.state.phase !== "holding") return;
    const valid = hands.filter((h) => Number.isFinite(h.confidence) && h.confidence >= 0.6);
    const gripping = (h: HandFrame) => Object.values(h.finger_folded).filter(Boolean).length >= 2;
    const hand = this.state.hand ? valid.find((h) => h.handedness === this.state.hand) :
      valid.find((h) => h.handedness === "right" && gripping(h)) ?? valid.find(gripping);
    if (!hand) { this.history = []; this.gripSince = null; return; }
    if (now - this.lastSeen > 150) { this.history = []; this.gripSince = null; }
    this.lastSeen = now;
    this.state.hand = hand.handedness;
    const p: V3 = [(0.5 - hand.palm_center.x) * 6, (0.5 - hand.palm_center.y) * 3.5, 0];
    if (!p.every(Number.isFinite)) return;
    if (gripping(hand)) {
      this.gripSince ??= now;
      this.history.push({ at: now, position: p });
      this.history = this.history.filter((s) => now - s.at <= 170);
      this.state.position = p;
      const first = this.history[0];
      const dt = first ? (now - first.at) / 1000 : 0;
      if (first && dt >= 0.04) this.state.velocity = gestureShot(p,
        Math.max(-6, Math.min(6, (p[0] - first.position[0]) / dt)),
        Math.max(-5, Math.min(5, (p[1] - first.position[1]) / dt)));
      this.state.message = "좌우로 조준 · 위로 밀어 올리며 손을 펼쳐 슛 · 점선은 예상 궤적입니다";
    } else {
      const open = [hand.finger_states.index, hand.finger_states.middle, hand.finger_states.ring, hand.finger_states.pinky].filter(Boolean).length >= 3;
      const first = this.history.find((s) => now - s.at <= 170);
      const dt = first ? (now - first.at) / 1000 : 0;
      const releaseVelocity: V3 = first && dt >= 0.04
        ? [Math.max(-6, Math.min(6, (p[0] - first.position[0]) / dt)), Math.max(-5, Math.min(5, (p[1] - first.position[1]) / dt)), -0.85]
        : [0, 0, 0];
      const speed = Math.hypot(releaseVelocity[0], releaseVelocity[1]);
      if (open && this.gripSince !== null && now - this.gripSince >= 120 && this.history.length >= 2 &&
        now - this.history.at(-1)!.at < 100 && speed > 1.1 && releaseVelocity[1] > 0.45) {
          this.state.position = p; this.launch(gestureShot(p, releaseVelocity[0], releaseVelocity[1]), now);
        }
      else if (open) { this.gripSince = null; this.history = []; this.state.velocity = [0, 0, 0]; this.state.message = "천천히 손을 펴면 놓지 않습니다. 다시 쥐고 빠르게 움직여 던져 주세요"; }
    }
  }

  launch(velocity: V3, now: number) {
    if (this.state.phase !== "holding") return;
    this.origin = [...this.state.position]; this.launchedAt = now;
    this.state.velocity = [...velocity]; this.state.phase = "flying"; this.state.message = "슛! 종이뭉치가 멀리 날아갑니다…";
  }

  throwAtBin(now: number, power = 1, aim = 0) {
    this.launch(basketballShot(this.state.position, power, aim), now);
  }

  step(now: number) {
    if (this.state.phase === "missed" && now - this.missedAt >= 600) {
      this.begin();
      this.state.message = "종이뭉치가 돌아왔습니다. 다시 잡고 던져 보세요";
    }
    if (this.state.phase === "holding" && this.state.hand && now - this.lastSeen > 300) {
      this.history = []; this.gripSince = null; this.state.velocity = [0, 0, 0];
      this.state.message = "손을 놓쳐 종이뭉치를 고정했습니다. 같은 손을 다시 쥐어 보여 주세요";
    }
    if (this.state.phase === "flying") {
      const time = Math.max(0, (now - this.launchedAt) / 1000);
      const p = flightPoint(this.origin, this.state.velocity, time);
      const disc = this.state.velocity[1] ** 2 + 2 * GRAVITY * (this.origin[1] - BIN.y);
      const crossing = disc >= 0 ? (this.state.velocity[1] + Math.sqrt(disc)) / GRAVITY : Infinity;
      if (crossing >= 0 && time >= crossing) {
        const [x, , z] = flightPoint(this.origin, this.state.velocity, crossing);
        if (Math.hypot(x - BIN.x, z - BIN.z) < BIN.radius - 0.12) {
          this.state.phase = "hit"; this.state.position = [BIN.x, BIN.y - 0.45, BIN.z]; this.state.message = "나이스 슛! 멀리 있는 쓰레기통에 골인했습니다";
        }
      }
      if (this.state.phase === "flying") {
        this.state.position = p;
        if (p[1] < -2.4 || Math.abs(p[0]) > 5 || time > 3) {
          this.missedAt = now;
          this.state.phase = "missed";
          this.state.position = [0, 0, 0]; this.state.velocity = [0, 0, 0]; this.state.hand = null;
          this.state.message = "통을 빗나갔습니다. 종이뭉치가 돌아와 곧 다시 던질 수 있습니다";
        }
      }
    }
    return { ...this.state, position: [...this.state.position] as V3, velocity: [...this.state.velocity] as V3 };
  }
}
