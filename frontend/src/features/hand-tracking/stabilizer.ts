import { buildHandFrame } from "../gestures/features";
import { OneEuroFilter } from "../gestures/filters";
import type { HandFrame } from "./types";

interface Track {
  frame: HandFrame;
  seenAt: number;
  filters: OneEuroFilter[];
}

/** Smooth landmarks before deriving finger states; match by position, never result order. */
export class HandStabilizer {
  private tracks: Track[] = [];

  process(hands: HandFrame[], now: number, aspect: number): HandFrame[] {
    const available = new Set(this.tracks.filter((t) => now - t.seenAt <= 200));
    const matches = new Map<HandFrame, Track>();
    const pairs = hands.flatMap((hand) => [...available].map((track) => ({
      hand, track,
      distance: Math.hypot(
        (hand.palm_center.x - track.frame.palm_center.x) * aspect,
        hand.palm_center.y - track.frame.palm_center.y,
      ),
    }))).sort((a, b) => a.distance - b.distance);
    for (const { hand, track, distance } of pairs) {
      if (matches.has(hand) || !available.has(track)) continue;
      if (distance > Math.max(hand.hand_size, track.frame.hand_size) * 1.5) continue;
      matches.set(hand, track);
      available.delete(track);
    }
    const current: Track[] = [];
    const frames = hands.map((hand) => {
      const track = matches.get(hand) ?? {
        frame: hand, seenAt: now,
        filters: hand.landmarks.map(() => new OneEuroFilter(3, 12)),
      };
      // Filtering in isotropic image coordinates keeps wide cameras equally stable on both axes.
      const landmarks = hand.landmarks.map((p, i) => {
        const q = track.filters[i]!.filter({ x: p.x * aspect, y: p.y, z: p.z * aspect }, now);
        return { x: q.x / aspect, y: q.y, z: q.z / aspect };
      });
      track.frame = buildHandFrame(landmarks, hand.handedness, hand.confidence, hand.timestamp, aspect);
      track.seenAt = now;
      current.push(track);
      return track.frame;
    });
    this.tracks = [...current, ...available];
    return frames;
  }

  reset(): void {
    this.tracks = [];
  }
}
