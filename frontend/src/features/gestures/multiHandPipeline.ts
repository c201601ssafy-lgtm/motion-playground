import type { HandFrame } from "../hand-tracking/types";
import type { FilterName } from "./filters";
import { GesturePipeline } from "./pipeline";
import { bothPalmsOpen } from "./twoHand";
import type { GestureEvent, HandId } from "./types";

export const HAND_IDS: HandId[] = ["left", "right"];

/** Each physical hand owns its classifier, filter, and gesture lifecycle. */
export class MultiHandPipeline {
  readonly pipelines: Record<HandId, GesturePipeline>;
  private previous: Partial<Record<HandId, { frame: HandFrame; seenAt: number }>> = {};

  constructor(filter: FilterName = "one-euro") {
    this.pipelines = { left: new GesturePipeline(filter), right: new GesturePipeline(filter) };
  }

  setFilter(filter: FilterName): void {
    for (const id of HAND_IDS) this.pipelines[id].setFilter(filter);
  }

  process(hands: HandFrame[], now: number) {
    const assigned = new Map<HandId, HandFrame>();
    const used = new Set<HandFrame>();
    const pairs = HAND_IDS.flatMap((id) => {
      const prev = this.previous[id];
      if (!prev || now - prev.seenAt > 250) return [];
      return hands.map((frame) => ({ id, frame, prev,
        distance: Math.hypot(frame.palm_center.x - prev.frame.palm_center.x, frame.palm_center.y - prev.frame.palm_center.y),
      }));
    }).sort((a, b) => a.distance - b.distance);
    for (const { id, frame, prev, distance } of pairs) {
      if (assigned.has(id) || used.has(frame)) continue;
      if (distance > Math.max(frame.hand_size, prev.frame.hand_size) * 1.5) continue;
      assigned.set(id, frame);
      used.add(frame);
    }
    for (const frame of hands) {
      if (used.has(frame)) continue;
      const id = [frame.handedness, ...HAND_IDS].find((key) => !assigned.has(key) &&
        (!this.previous[key] || now - this.previous[key]!.seenAt > 250));
      if (id) {
        assigned.set(id, frame);
        used.add(frame);
      }
    }
    const pairedPalm = bothPalmsOpen(hands) && HAND_IDS.every((id) => this.pipelines[id].machine.current !== "PINCH");
    const results = HAND_IDS.map((id) => {
      const frame = assigned.get(id) ?? null;
      if (frame) this.previous[id] = { frame, seenAt: now };
      const result = this.pipelines[id].process(pairedPalm ? null : frame, now);
      // Two open palms belong to the paired gesture; each remaining hand keeps its own lifecycle.
      const events = result.events.map((event): GestureEvent => ({ ...event, hand: id }));
      return { id, ...result, events, current: this.pipelines[id].machine.current };
    });
    const holdingAndRotating = results.some((r) => assigned.has(r.id) && r.current === "OPEN_PALM" &&
      results.some((other) => other.id !== r.id && assigned.has(other.id) && other.current === "PINCH"));
    return { results, events: results.flatMap((r) => r.events), allowRotation: hands.length === 1 || holdingAndRotating };
  }

  reset(now: number): GestureEvent[] {
    const events: GestureEvent[] = [];
    for (const id of HAND_IDS) {
      for (let i = 0; i < 5; i++) events.push(...this.pipelines[id].process(null, now).events.map((e) => ({ ...e, hand: id })));
      this.pipelines[id].reset();
    }
    this.previous = {};
    return events;
  }
}
