import type { HandFrame } from "../hand-tracking/types";

export class CrumpleGesture {
  private baseline: number | null = null;
  private openSince: number | null = null;
  private closeHeld = 0;
  private closeCandidate = false;
  private pairAt: number | null = null;
  private seenAt = -Infinity;
  progress = 0;
  closed = false;
  message = "두 손을 펼쳐 창 양쪽을 잡듯 벌려 주세요";

  observe(hands: HandFrame[], now: number, aspect = 4 / 3): void {
    if (this.closed) return;
    const valid = hands.filter((h) => Number.isFinite(h.confidence) && h.confidence >= 0.6);
    if (valid.length !== 2) {
      this.openSince = null;
      this.pairAt = null;
      if (this.baseline !== null) this.message = "손이 잠깐 겹쳤습니다. 조금만 벌려 두 손을 보여 주세요";
      return;
    }
    const elapsed = this.pairAt === null ? 0 : Math.min(250, Math.max(0, now - this.pairAt));
    this.pairAt = now;
    this.seenAt = now;
    const [a, b] = valid as [HandFrame, HandFrame];
    const size = (a.hand_size + b.hand_size) / 2;
    if (!Number.isFinite(size) || size <= 0) return;
    const separation = Math.hypot((a.palm_center.x - b.palm_center.x) * aspect, a.palm_center.y - b.palm_center.y) / size;
    const extended = (h: HandFrame) => [h.finger_states.index, h.finger_states.middle, h.finger_states.ring, h.finger_states.pinky].filter(Boolean).length;
    // A curled finger need not place its tip behind the PIP joint to count.
    const fold = valid.reduce((sum, h) => sum + Math.max(
      Object.values(h.finger_folded).filter(Boolean).length / 4,
      (4 - extended(h)) / 4,
    ), 0) / 2;
    if (this.baseline === null) {
      if (extended(a) >= 3 && extended(b) >= 3 && separation > 2.5) {
        this.openSince ??= now;
        if (now - this.openSince >= 250) { this.baseline = separation; this.message = "손가락을 오므리면서 두 손을 가운데로 모아 구겨 보세요"; }
      } else this.openSince = null;
      return;
    }
    const squeeze = Math.max(0, Math.min(1, (1 - separation / this.baseline) / 0.75));
    this.progress = Math.max(0, Math.min(0.87, squeeze * 0.72 + fold * 0.28));
    // Commit before the palms overlap and the tracker loses one hand.
    const closing = squeeze > (this.closeCandidate ? 0.48 : 0.58) && fold >= (this.closeCandidate ? 0.25 : 0.375);
    if (closing) {
      if (this.closeCandidate) this.closeHeld += elapsed;
      this.closeCandidate = true;
      this.message = "꾹 구기는 중…";
      if (this.closeHeld >= 140) { this.closed = true; this.progress = 1; this.message = "창 모형을 구겨서 닫았습니다"; }
    } else { this.closeHeld = 0; this.closeCandidate = false; this.message = "손가락을 오므리면서 두 손을 가운데로 모아 주세요"; }
  }

  tick(now: number) {
    if (!this.closed && this.baseline !== null && now - this.seenAt > 900) {
      this.baseline = null; this.progress = 0; this.closeHeld = 0; this.closeCandidate = false; this.openSince = null; this.pairAt = null;
      this.message = "두 손이 안 보입니다. 손을 다시 벌려 시작해 주세요";
    }
    return { progress: this.progress, closed: this.closed, armed: this.baseline !== null, message: this.message };
  }
}

/** Deterministic folding: a flat textured sheet becomes a faceted paper ball. */
export function crumpledVertex(x: number, y: number, progress: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, progress));
  const mix = t * t * (3 - 2 * t);
  // Broad folded panels instead of many high-frequency spikes; the sheet wraps once.
  const azimuth = x * 1.13 + Math.sin(y * 3.1) * 0.28;
  const latitude = y * 0.93 + Math.sin(x * 2.7) * 0.19;
  const crease = 0.075 * Math.sin(x * 5.3 + y * 4.1) + 0.04 * Math.cos(y * 7.2 - x * 3.3);
  const radius = 0.40 + crease + 0.06 * (Math.abs(Math.sin(x * 3.4 + y * 1.7)) - 0.5);
  const bx = Math.sin(azimuth) * Math.cos(latitude) * radius;
  const by = Math.sin(latitude) * radius;
  const bz = Math.cos(azimuth) * Math.cos(latitude) * radius;
  const fold = Math.sin(x * 4.2 + y * 2.8) * Math.sin(y * 5.1 - x * 2.3) * 0.22;
  return [x * (1 - mix) + bx * mix, y * (1 - mix) + by * mix,
    bz * mix + fold * Math.sin(t * Math.PI)];
}
