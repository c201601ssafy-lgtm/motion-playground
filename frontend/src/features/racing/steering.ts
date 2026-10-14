import type { HandFrame } from "../hand-tracking/types";

export const STEERING_PARAMS = {
  deadZoneDeg: 5, maxAngleDeg: 30, smoothingMs: 80,
  brakeHoldMs: 120, calibrationMs: 500, calibrationToleranceDeg: 6,
  dropoutHoldMs: 200, pauseAfterMs: 1000, minConfidence: 0.6,
};

export interface SteeringState {
  status: "waiting" | "calibrating" | "ready" | "lost" | "paused";
  angle: number;
  rawAngle: number;
  steering: number;
  brake: boolean;
  speed: number;
  progress: number;
  hands: number;
  message: string;
}

/** Screen mirror + aspect correction; wrists keep finger opening out of the steering signal. */
export function wheelObservation(hands: HandFrame[], aspect = 4 / 3) {
  const valid = hands.filter((h) => Number.isFinite(h.confidence) && h.confidence >= STEERING_PARAMS.minConfidence);
  if (valid.length !== 2 || !Number.isFinite(aspect) || aspect <= 0) return null;
  const [right, left] = [...valid].sort((a, b) => a.landmarks[0]!.x - b.landmarks[0]!.x);
  const a = left!.landmarks[0]!, b = right!.landmarks[0]!;
  const dx = (a.x - b.x) * aspect, dy = b.y - a.y;
  if (!Number.isFinite(dx + dy) || dx <= 0 || Math.hypot(dx, dy) < (left!.hand_size + right!.hand_size) * 0.65) return null;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (Math.abs(angle) > 75) return null;
  const open = valid.every((h) => h.finger_states.index && h.finger_states.middle && h.finger_states.ring && h.finger_states.pinky);
  return { angle, open };
}

export class SteeringController {
  private observation: ReturnType<typeof wheelObservation> = null;
  private seenAt = -Infinity;
  private neutral: number | null = null;
  private calibrating = false;
  private samples: { at: number; angle: number }[] = [];
  private brakeCandidate = false;
  private brakeSince = 0;
  private lastStep: number | null = null;
  private angle = 0;
  private brake = false;
  private speed = 0;
  private handCount = 0;
  private frameAt = -Infinity;

  observe(hands: HandFrame[], now: number, aspect = 4 / 3): void {
    this.frameAt = now;
    this.handCount = hands.filter((h) => h.confidence >= STEERING_PARAMS.minConfidence).length;
    const observation = wheelObservation(hands, aspect);
    this.observation = observation;
    if (!observation) {
      this.samples = [];
      this.brakeCandidate = false;
      this.brakeSince = now;
      return;
    }
    const gap = now - this.seenAt;
    this.seenAt = now;
    if (observation.open !== this.brakeCandidate || gap > STEERING_PARAMS.dropoutHoldMs) {
      this.brakeCandidate = observation.open;
      this.brakeSince = now;
    }
    if (this.calibrating) {
      if (gap > STEERING_PARAMS.dropoutHoldMs || this.samples.some((s) => Math.abs(s.angle - observation.angle) > STEERING_PARAMS.calibrationToleranceDeg)) this.samples = [];
      this.samples.push({ at: now, angle: observation.angle });
      if (now - this.samples[0]!.at >= STEERING_PARAMS.calibrationMs) {
        this.neutral = this.samples.reduce((sum, s) => sum + s.angle, 0) / this.samples.length;
        this.calibrating = false;
        this.angle = 0;
        this.speed = 0;
      }
    }
  }

  calibrate(): void {
    this.calibrating = true;
    this.neutral = null;
    this.samples = [];
    this.speed = 0;
    this.angle = 0;
    this.brake = false;
  }

  step(now: number, paused = false): SteeringState {
    const dt = this.lastStep === null ? 0 : Math.max(0, Math.min(now - this.lastStep, 100));
    this.lastStep = now;
    const age = now - this.seenAt;
    const fresh = !!this.observation && age <= STEERING_PARAMS.dropoutHoldMs;
    let status: SteeringState["status"] = this.calibrating ? "calibrating" : this.neutral === null ? "waiting" : "ready";
    if (this.neutral !== null && !fresh) status = age >= STEERING_PARAMS.pauseAfterMs ? "paused" : "lost";
    if (paused) status = "paused";
    if (fresh && this.neutral !== null) {
      const target = Math.max(-30, Math.min(30, this.observation!.angle - this.neutral));
      this.angle += (target - this.angle) * (1 - Math.exp(-dt / STEERING_PARAMS.smoothingMs));
      if (now - this.brakeSince >= STEERING_PARAMS.brakeHoldMs) this.brake = this.brakeCandidate;
    }
    if (age > STEERING_PARAMS.dropoutHoldMs || !this.observation) this.brake = true;
    if (status === "waiting" || status === "calibrating" || status === "paused") this.speed = 0;
    else this.speed = Math.max(0, Math.min(120, this.speed + (this.brake || !fresh ? -85 : 24) * dt / 1000));
    const steering = Math.sign(this.angle) * Math.max(0, Math.abs(this.angle) - STEERING_PARAMS.deadZoneDeg) /
      (STEERING_PARAMS.maxAngleDeg - STEERING_PARAMS.deadZoneDeg);
    return { status, angle: this.angle, rawAngle: this.observation?.angle ?? 0,
      steering, brake: this.brake, speed: this.speed, hands: now - this.frameAt <= STEERING_PARAMS.dropoutHoldMs ? this.handCount : 0,
      progress: this.calibrating && fresh && this.samples.length ? Math.min(1, (now - this.samples[0]!.at) / STEERING_PARAMS.calibrationMs) : 0,
      message: paused ? "테스트가 일시정지되었습니다" : status === "calibrating" ? "편한 핸들 자세로 두 손을 0.5초 유지해 주세요" : status === "waiting" ? "카메라를 켜고 두 손을 든 뒤 중앙 맞추기를 눌러 주세요" :
        status === "paused" ? "손 추적이 끊겨 일시정지했습니다. 두 손을 다시 보여 주세요" : status === "lost" ? "두 손을 충분히 벌려 카메라에 보여 주세요 · 자동 감속 중" : this.brake ? "브레이크 · 손을 펼친 채 조향할 수 있습니다" : "자동 가속 · 두 손을 기울여 조향하세요" };
  }
}
