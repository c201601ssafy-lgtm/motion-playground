import { describe, expect, it } from "vitest";
import { CommandBus, type CommandEnvelope } from "../src/features/commands/commandBus";
import { KeyboardCommandSource } from "../src/features/commands/keyboardSource";
import { MouseCommandSource, ROTATE_SENSITIVITY } from "../src/features/commands/mouseSource";
import { gearOutline } from "../src/three/gearShape";

class FakeCanvas extends EventTarget {
  getBoundingClientRect() {
    return { left: 100, top: 50, width: 200, height: 100 };
  }
}

function fire(target: EventTarget, type: string, props: Record<string, unknown>) {
  const ev = new Event(type);
  for (const [k, v] of Object.entries(props)) Object.defineProperty(ev, k, { value: v });
  target.dispatchEvent(ev);
}

function collect(bus: CommandBus): CommandEnvelope[] {
  const out: CommandEnvelope[] = [];
  bus.subscribe((e) => out.push(e));
  return out;
}

describe("CommandBus", () => {
  it("publishes to subscribers with source and timestamp, and unsubscribes", () => {
    const bus = new CommandBus(() => 42);
    const seen: CommandEnvelope[] = [];
    const unsub = bus.subscribe((e) => seen.push(e));
    bus.publish({ type: "CANCEL" }, "test");
    unsub();
    bus.publish({ type: "CANCEL" }, "test");
    expect(seen).toEqual([{ command: { type: "CANCEL" }, source: "test", timestamp: 42 }]);
  });
});

describe("MouseCommandSource", () => {
  it("maps left drag to grab/move/release in normalized coordinates", () => {
    const bus = new CommandBus();
    const out = collect(bus);
    const canvas = new FakeCanvas();
    new MouseCommandSource(canvas).start(bus);

    fire(canvas, "pointerdown", { clientX: 200, clientY: 100, button: 0 });
    fire(canvas, "pointermove", { clientX: 250, clientY: 75, button: 0 });
    fire(canvas, "pointerup", { clientX: 250, clientY: 75, button: 0 });

    expect(out.map((e) => e.command)).toEqual([
      { type: "GRAB_PART", screen: { x: 0.5, y: 0.5 } },
      { type: "MOVE_PART", screen: { x: 0.75, y: 0.25 } },
      { type: "RELEASE_PART", screen: { x: 0.75, y: 0.25 } },
    ]);
    expect(out.every((e) => e.source === "mouse")).toBe(true);
  });

  it("maps right drag to ROTATE_MODEL and plain move to HOVER", () => {
    const bus = new CommandBus();
    const out = collect(bus);
    const canvas = new FakeCanvas();
    new MouseCommandSource(canvas).start(bus);

    fire(canvas, "pointermove", { clientX: 150, clientY: 60, button: -1 });
    fire(canvas, "pointerdown", { clientX: 200, clientY: 100, button: 2 });
    fire(canvas, "pointermove", { clientX: 220, clientY: 100, button: 2 });
    fire(canvas, "pointerup", { clientX: 220, clientY: 100, button: 2 });

    expect(out[0]?.command.type).toBe("HOVER");
    const rot = out[1]?.command;
    expect(rot?.type).toBe("ROTATE_MODEL");
    if (rot?.type === "ROTATE_MODEL") {
      expect(rot.dYaw).toBeCloseTo(0.1 * ROTATE_SENSITIVITY);
      expect(rot.dPitch).toBe(0);
    }
    expect(out).toHaveLength(2); // 오른쪽 버튼 놓기는 RELEASE_PART를 내지 않음
  });

  it("stops emitting after stop()", () => {
    const bus = new CommandBus();
    const out = collect(bus);
    const canvas = new FakeCanvas();
    const src = new MouseCommandSource(canvas);
    src.start(bus);
    src.stop();
    fire(canvas, "pointerdown", { clientX: 200, clientY: 100, button: 0 });
    expect(out).toHaveLength(0);
  });
});

describe("KeyboardCommandSource", () => {
  it("maps bound keys and ignores typing and modifiers", () => {
    const bus = new CommandBus();
    const out = collect(bus);
    const win = new EventTarget();
    new KeyboardCommandSource(win).start(bus);

    fire(win, "keydown", { key: "E" });
    fire(win, "keydown", { key: "Escape" });
    fire(win, "keydown", { key: "a", ctrlKey: true });
    fire(win, "keydown", { key: "r", target: { tagName: "INPUT" } });
    fire(win, "keydown", { key: "e", repeat: true });
    fire(win, "keydown", { key: "x" });

    expect(out.map((e) => e.command.type)).toEqual(["EXPLODE", "CANCEL"]);
  });
});

describe("gearOutline", () => {
  it("produces 4 points per tooth between root and tip radius", () => {
    const m = 0.05;
    const pts = gearOutline(12, m);
    expect(pts).toHaveLength(48);
    const radii = pts.map((p) => Math.hypot(p.x, p.y));
    const pitch = (m * 12) / 2;
    expect(Math.max(...radii)).toBeCloseTo(pitch + m);
    expect(Math.min(...radii)).toBeCloseTo(pitch - 1.25 * m);
  });
});
