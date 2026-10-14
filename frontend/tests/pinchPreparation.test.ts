import { describe, expect, it } from "vitest";
import { CommandBus } from "../src/features/commands/commandBus";
import type { Command } from "../src/features/commands/types";
import { buildHandFrame } from "../src/features/gestures/features";
import { GestureCommandSource, toScreen } from "../src/features/gestures/gestureCommandSource";
import { GesturePipeline } from "../src/features/gestures/pipeline";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";
import type { GestureEvent } from "../src/features/gestures/types";

// Controlled observations reproduce fingertip drift while the same palm stays still.
const observation = (t: number, distance: number, indexX: number, pose: "POINT" | "PINCH" = "POINT") => {
  const frame = buildHandFrame(syntheticHand(POSES[pose]), "right", 0.95, t);
  frame.pinch_distance = distance;
  frame.landmarks[8] = { ...frame.landmarks[8]!, x: indexX };
  frame.landmarks[4] = { ...frame.landmarks[4]!, x: indexX - distance * frame.hand_size };
  return frame;
};

function setup() {
  const pipeline = new GesturePipeline("none");
  const listeners = new Set<(e: GestureEvent) => void>();
  const bus = new CommandBus();
  const commands: Command[] = [];
  bus.subscribe((e) => commands.push(e.command));
  const source = new GestureCommandSource((l) => {
    listeners.add(l);
    return () => { listeners.delete(l); };
  });
  source.start(bus);
  const process = (frame: ReturnType<typeof observation> | null, t: number) => {
    const result = pipeline.process(frame, t);
    for (const e of result.events) for (const l of listeners) l(e);
    return result;
  };
  for (const t of [0, 33, 66, 99]) process(observation(t, 1.2, 0.4), t);
  return { pipeline, commands, process };
}

describe("point to pinch preparation", () => {
  it("locks before pinch classification and ignores index drift until confirmed", () => {
    const { commands, process } = setup();
    const target = commands.at(-1)!;
    const prepared = process(observation(132, 0.65, 0.5), 132);
    expect(prepared.classification.type).toBe("POINT");
    expect(prepared.events[0]?.selectionLocked).toBe(true);
    expect(prepared.events[0]?.position.x).toBe(0.4);
    expect(commands.at(-1)).toEqual({ type: "LOCK_SELECTION", locked: true });
    expect(commands.some((c) => c.type === "GRAB_PART")).toBe(false);
    process(observation(165, 0.5, 0.55), 165);
    for (const t of [198, 231, 264]) process(observation(t, 0.2, 0.6, "PINCH"), t);
    const grab = commands.find((c) => c.type === "GRAB_PART");
    expect(grab?.useHovered).toBe(true);
    if (target.type === "HOVER") expect(grab?.screen).toEqual(target.screen);
    process(observation(297, 0.2, 0.6, "PINCH"), 297);
    const firstMove = commands.find((c) => c.type === "MOVE_PART");
    expect(firstMove?.screen).toEqual(grab?.screen);
    process(observation(330, 0.2, 0.62, "PINCH"), 330);
    const nextMove = commands.at(-1);
    if (nextMove?.type === "MOVE_PART" && firstMove?.type === "MOVE_PART") {
      expect(nextMove.screen.x - firstMove.screen.x).toBeCloseTo(-0.03);
    }
  });

  it("unlocks and resumes pointing when the fingers reopen without grabbing", () => {
    const { commands, process } = setup();
    process(observation(132, 0.65, 0.5), 132);
    const reopened = process(observation(165, 1.1, 0.55), 165);
    expect(reopened.events[0]?.selectionLocked).toBe(false);
    expect(reopened.events[0]?.position.x).toBe(0.55);
    expect(commands.some((c) => c.type === "GRAB_PART")).toBe(false);
    expect(commands.at(-2)).toEqual({ type: "LOCK_SELECTION", locked: false });
    const hover = commands.at(-1);
    expect(hover?.type).toBe("HOVER");
    if (hover?.type === "HOVER") expect(hover.screen.x).toBeCloseTo(toScreen({ x: 0.55, y: 0 }).x);
  });

  it("keeps the last pointing target during intermediate unclassified bending frames", () => {
    const { process } = setup();
    const f = observation(132, 0.9, 0.55);
    f.finger_states.index = false;
    const result = process(f, 132);
    expect(result.classification.type).toBe("NONE");
    expect(result.events[0]?.position.x).toBe(0.4);
  });

  it("does not arm selection from a low-confidence closing observation", () => {
    const { commands, process } = setup();
    const f = observation(132, 0.6, 0.5);
    f.confidence = 0.2;
    expect(process(f, 132).events).toEqual([]);
    expect(commands.some((c) => c.type === "LOCK_SELECTION")).toBe(false);
  });

  it("clears preparation after tracking disappears and after reset", () => {
    const { pipeline, commands, process } = setup();
    process(observation(132, 0.65, 0.5), 132);
    for (let i = 0; i < 5; i++) process(null, 165 + i * 33);
    expect(commands.at(-1)).toEqual({ type: "LOCK_SELECTION", locked: false });
    pipeline.reset();
    for (const t of [400, 433, 466]) process(observation(t, 1.2, 0.7), t);
    const locked = process(observation(499, 0.65, 0.8), 499);
    expect(locked.events[0]?.position.x).toBe(0.7);
  });
});
