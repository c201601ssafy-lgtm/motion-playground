import { describe, expect, it } from "vitest";
import { CommandBus } from "../src/features/commands/commandBus";
import type { Command } from "../src/features/commands/types";
import { buildHandFrame } from "../src/features/gestures/features";
import { GestureCommandSource } from "../src/features/gestures/gestureCommandSource";
import { HAND_IDS, MultiHandPipeline } from "../src/features/gestures/multiHandPipeline";
import { POSES, syntheticHand } from "../src/features/gestures/synthetic";
import type { GestureEvent, HandId } from "../src/features/gestures/types";
import { useLabStore } from "../src/store/labStore";
import { DragSessions } from "../src/three/dragSessions";

const frame = (id: HandId, pose: keyof typeof POSES, x: number, t: number) =>
  buildHandFrame(syntheticHand(POSES[pose], { wrist: { x, y: 0.78 }, scale: 0.15 }), id, 0.95, t);

function setup() {
  const pipeline = new MultiHandPipeline("none");
  const bus = new CommandBus();
  const commands: Command[] = [];
  const listeners = new Set<(e: GestureEvent) => void>();
  bus.subscribe((e) => commands.push(e.command));
  const sources = HAND_IDS.map((id) => new GestureCommandSource((l) => {
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, undefined, id));
  sources.forEach((s) => s.start(bus));
  const process = (left: keyof typeof POSES | null, right: keyof typeof POSES | null, t: number, reverse = false, leftX = 0.2, rightX = 0.8) => {
    const hands = [left && frame("left", left, leftX, t), right && frame("right", right, rightX, t)].filter((f) => !!f);
    const result = pipeline.process(reverse ? hands.reverse() : hands, t);
    for (const e of result.events) for (const l of listeners) l(e);
    return result;
  };
  return { pipeline, commands, process };
}

describe("simultaneous hand work", () => {
  it("starts and moves two pinches independently even when result order reverses", () => {
    const { commands, process } = setup();
    for (let i = 0; i < 6; i++) process("PINCH", "PINCH", i * 33, i % 2 === 0);
    for (const hand of HAND_IDS) {
      expect(commands.filter((c) => c.type === "GRAB_PART" && c.hand === hand)).toHaveLength(1);
      expect(commands.filter((c) => c.type === "MOVE_PART" && c.hand === hand)).toHaveLength(3);
    }
    const grabs = commands.filter((c) => c.type === "GRAB_PART");
    expect(grabs[0]!.screen.x).not.toBeCloseTo(grabs[1]!.screen.x);
  });

  it("points with one hand while the other holds a part, then cancels only one hand", () => {
    const { commands, process } = setup();
    for (let i = 0; i < 6; i++) process("POINT", "PINCH", i * 50);
    expect(commands.some((c) => c.type === "HOVER" && c.hand === "left")).toBe(true);
    expect(commands.some((c) => c.type === "MOVE_PART" && c.hand === "right")).toBe(true);
    expect(commands.some((c) => c.type === "ROTATE_MODEL")).toBe(false);
    for (let i = 6; i < 10; i++) process("FIST", "PINCH", i * 50);
    expect(commands.filter((c) => c.type === "CANCEL").map((c) => c.hand)).toEqual(["left"]);
    expect(commands.at(-1)?.type).toBe("MOVE_PART");
    expect(commands.at(-1)?.hand).toBe("right");
  });

  it("does not transfer a missing hand's pinch to the surviving hand", () => {
    const { commands, process } = setup();
    for (let i = 0; i < 6; i++) process("PINCH", "PINCH", i * 33);
    commands.length = 0;
    for (let i = 6; i < 11; i++) process(null, "PINCH", i * 33);
    expect(commands.filter((c) => c.type === "MOVE_PART").every((c) => c.hand === "right")).toBe(true);
    expect(commands.filter((c) => c.type === "CANCEL").map((c) => c.hand)).toEqual(["left"]);
    expect(commands.some((c) => c.type === "RELEASE_PART")).toBe(false);
  });

  it("does not let one hand's cancellation consume the other's release", async () => {
    const { commands, process } = setup();
    for (let i = 0; i < 6; i++) process("PINCH", "PINCH", i * 50);
    commands.length = 0;
    for (let i = 6; i < 9; i++) process("FIST", "POINT", i * 50);
    await Promise.resolve();
    expect(commands.filter((c) => c.type === "CANCEL").map((c) => c.hand)).toEqual(["left"]);
    expect(commands.filter((c) => c.type === "RELEASE_PART").map((c) => c.hand)).toEqual(["right"]);
  });

  it("releases two held parts independently in the same frame", async () => {
    const { commands, process } = setup();
    for (let i = 0; i < 6; i++) process("PINCH", "PINCH", i * 50);
    commands.length = 0;
    for (let i = 6; i < 9; i++) process("POINT", "POINT", i * 50);
    await Promise.resolve();
    expect(commands.filter((c) => c.type === "RELEASE_PART").map((c) => c.hand)).toEqual(["left", "right"]);
  });

  it("cancels both active hands when tracking stops", () => {
    const { pipeline, process } = setup();
    for (let i = 0; i < 6; i++) process("PINCH", "PINCH", i * 33);
    expect(pipeline.reset(200).map((e) => [e.hand, e.phase, e.trackingLost])).toEqual([
      ["left", "end", true], ["right", "end", true],
    ]);
    expect(pipeline.pipelines.left.machine.current).toBe("NONE");
    expect(pipeline.pipelines.right.machine.current).toBe("NONE");
  });

  it("reserves paired open palms for paired gestures and allows rotation only with one hand", () => {
    const { process } = setup();
    for (let i = 0; i < 6; i++) expect(process("OPEN_PALM", "OPEN_PALM", i * 33).events).toEqual([]);
    expect(process("OPEN_PALM", "POINT", 200).allowRotation).toBe(false);
    expect(process(null, "OPEN_PALM", 233).allowRotation).toBe(true);
  });

  it.each(HAND_IDS)("lets the opposite palm rotate while %s keeps holding", (holding) => {
    const { commands, process } = setup();
    let result;
    for (let i = 0; i < 8; i++) {
      result = process(holding === "left" ? "PINCH" : "OPEN_PALM",
        holding === "right" ? "PINCH" : "OPEN_PALM", i * 33, i % 2 === 0,
        0.2 + (holding === "right" ? i * 0.005 : 0),
        0.8 - (holding === "left" ? i * 0.005 : 0));
    }
    const rotating = holding === "left" ? "right" : "left";
    expect(result?.allowRotation).toBe(true);
    expect(commands.filter((c) => c.type === "GRAB_PART" && c.hand === holding)).toHaveLength(1);
    expect(commands.some((c) => c.type === "MOVE_PART" && c.hand === holding)).toBe(true);
    expect(commands.some((c) => c.type === "ROTATE_MODEL" && c.hand === rotating)).toBe(true);
    expect(commands.some((c) => c.type === "RELEASE_PART" || c.type === "CANCEL")).toBe(false);
  });
});

describe("exclusive part ownership", () => {
  it("allows a free hand to rotate while preserving the grabbing hand's ownership", () => {
    const sessions = new DragSessions(() => ({ partId: null as string | null }));
    sessions.claim("left", "gear-a");
    expect(sessions.canRotate("right")).toBe(true);
    expect(sessions.canRotate("left")).toBe(false);
    expect(sessions.canRotate(null)).toBe(false);
    expect(sessions.get("left").partId).toBe("gear-a");
    sessions.claim("right", "gear-b");
    expect(sessions.canRotate("right")).toBe(false);
  });
  it("holds distinct parts concurrently and releases only the chosen session", () => {
    const sessions = new DragSessions(() => ({ partId: null as string | null }));
    expect(sessions.claim("left", "gear-a")).toBe(true);
    expect(sessions.claim("right", "gear-a")).toBe(false);
    expect(sessions.claim("right", "gear-b")).toBe(true);
    sessions.get("left").partId = null;
    expect(sessions.get("right").partId).toBe("gear-b");
    expect(sessions.claim("pointer", "gear-a")).toBe(true);
    expect(sessions.claim("pointer", "gear-b")).toBe(false);
  });

  it("retains the other hand's store state and cursor when one hand releases", () => {
    useLabStore.setState({ interactions: {}, handCursors: {} });
    const s = useLabStore.getState();
    s.setInteraction("left", { selected: "gear-a", dragging: "gear-a" });
    s.setInteraction("right", { selected: "gear-b", dragging: "gear-b" });
    s.setHandCursor("left", { gesture: "PINCH", screen: { x: 0.2, y: 0.5 } });
    s.setHandCursor("right", { gesture: "POINT", screen: { x: 0.8, y: 0.5 } });
    s.setInteraction("left", { dragging: null, selected: null });
    s.setHandCursor("left", null);
    expect(useLabStore.getState().draggingPartId).toBe("gear-b");
    expect(useLabStore.getState().handCursors.right?.gesture).toBe("POINT");
    useLabStore.setState({ interactions: {}, handCursors: {}, draggingPartId: null, selectedPartId: null, cursor: null });
  });
});
