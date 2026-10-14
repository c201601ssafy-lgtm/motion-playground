import type { HandFrame } from "../hand-tracking/types";

/** Lock the pointed card before pinching moves the index fingertip. */
export class TabSelectionGesture {
  private target: number | null = null;
  private pointedAt = -Infinity;
  private since = 0;
  private pinchSince: number | null = null;
  private latched = false;
  private hand: string | null = null;
  observe(hand: HandFrame | undefined, hit: number | null, now: number) {
    if (!hand || hand.confidence < 0.6 || !Number.isFinite(hand.pinch_distance)) {
      this.pinchSince = null; return null;
    }
    if (this.hand !== hand.handedness) {
      this.hand = hand.handedness; this.target = null; this.pinchSince = null; this.latched = false;
    }
    if (hand.pinch_distance > 0.5) {
      this.latched = false; this.pinchSince = null;
      if (hand.finger_states.index && !hand.finger_states.middle && !hand.finger_states.ring && !hand.finger_states.pinky) {
        if (hit !== this.target || now - this.pointedAt > 300) this.since = now;
        this.target = hit; this.pointedAt = now;
      }
    } else if (hand.pinch_distance < 0.32 && !this.latched && this.target !== null && now - this.pointedAt <= 350 && this.pointedAt - this.since >= 100) {
      this.pinchSince ??= now;
      if (now - this.pinchSince >= 80) { this.latched = true; return this.target; }
    } else this.pinchSince = null;
    return null;
  }
  get hovered() { return this.target; }
}
