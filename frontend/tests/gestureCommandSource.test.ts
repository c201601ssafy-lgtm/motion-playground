import { describe, expect, it } from "vitest";
import { CommandBus } from "../src/features/commands/commandBus";
import type { Command } from "../src/features/commands/types";
import { GESTURE_MAPPING, GestureCommandSource, type HandCursor, toScreen } from "../src/features/gestures/gestureCommandSource";
import type { GestureEvent } from "../src/features/gestures/types";

function setup() {
  let emit: (e: GestureEvent) => void = () => {};
  const bus = new CommandBus();
  const commands: Command[] = [];
  const cursors: (HandCursor | null)[] = [];
  bus.subscribe((e) => commands.push(e.command));
  const src = new GestureCommandSource(
    (l) => {
      emit = l;
      return () => {
        emit = () => {};
      };
    },
    (c) => cursors.push(c),
  );
  src.start(bus);
  return { emit: (e: GestureEvent) => emit(e), commands, cursors, src };
}

const ev = (type: GestureEvent["type"], phase: GestureEvent["phase"], x = 0.5, y = 0.5, dx = 0, dy = 0): GestureEvent => ({
  type,
  phase,
  position: { x, y, z: 0 },
  delta: { x: dx, y: dy },
  confidence: 0.9,
  timestamp: 0,
});

describe("toScreen", () => {
  it("mirrors x and applies gain around the center", () => {
    expect(toScreen({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
    const s = toScreen({ x: 0.4, y: 0.6 });
    expect(s.x).toBeCloseTo(0.5 + 0.1 * GESTURE_MAPPING.screenGain);
    expect(s.y).toBeCloseTo(0.5 + 0.1 * GESTURE_MAPPING.screenGain);
    expect(toScreen({ x: -1, y: 2 })).toEqual({ x: 1, y: 1 });
  });
});

describe("GestureCommandSource", () => {
  it("maps pinch start/hold/end to grab/move/release", async () => {
    const { emit, commands } = setup();
    emit(ev("PINCH", "start"));
    emit(ev("PINCH", "hold", 0.4));
    emit(ev("PINCH", "end", 0.4));
    await Promise.resolve();
    expect(commands.map((c) => c.type)).toEqual(["GRAB_PART", "MOVE_PART", "RELEASE_PART"]);
  });

  it("turns pinch end followed by fist start into cancel instead of release", async () => {
    const { emit, commands } = setup();
    emit(ev("PINCH", "start"));
    emit(ev("PINCH", "end"));
    emit(ev("FIST", "start"));
    await Promise.resolve();
    expect(commands.map((c) => c.type)).toEqual(["GRAB_PART", "CANCEL"]);
  });

  it("maps open palm movement to rotation (mirrored) and hover", () => {
    const { emit, commands } = setup();
    emit(ev("OPEN_PALM", "start"));
    emit(ev("OPEN_PALM", "hold", 0.45, 0.5, -0.05, 0.02));
    const rot = commands.find((c) => c.type === "ROTATE_MODEL");
    expect(rot).toBeDefined();
    if (rot?.type === "ROTATE_MODEL") {
      expect(rot.dYaw).toBeGreaterThan(0); // 이미지 x 감소 = 사용자 기준 오른쪽
      expect(rot.dPitch).toBeGreaterThan(0);
    }
    expect(commands.filter((c) => c.type === "HOVER")).toHaveLength(2);
  });

  it("maps fist start to cancel only once", () => {
    const { emit, commands } = setup();
    emit(ev("FIST", "start"));
    emit(ev("FIST", "hold"));
    emit(ev("FIST", "end"));
    expect(commands).toEqual([{ type: "CANCEL" }]);
  });

  it("reports cursor and clears it on end and stop", () => {
    const { emit, cursors, src } = setup();
    emit(ev("PINCH", "start"));
    emit(ev("PINCH", "end"));
    expect(cursors[0]?.gesture).toBe("PINCH");
    expect(cursors[1]).toBeNull();
    src.stop();
    expect(cursors.at(-1)).toBeNull();
  });
});

describe("손목 회전 → 부품 회전 (P5-6)", () => {
  const pinch = (phase: GestureEvent["phase"], roll: number): GestureEvent => ({ ...ev("PINCH", phase), roll });
  const rotations = (commands: Command[]) =>
    commands.flatMap((c) => (c.type === "ROTATE_PART" ? [c.dYawDeg] : []));

  it("집은 채 손목을 한 칸(7.5°)씩 돌릴 때마다 15°씩 돌린다", () => {
    const { emit, commands } = setup();
    emit(pinch("start", 0));
    emit(pinch("hold", 5)); // 아직 한 칸 안 됨
    expect(rotations(commands)).toEqual([]);
    emit(pinch("hold", 16)); // 누적 16° → 두 칸
    expect(rotations(commands)).toEqual([15, 15]);
    emit(pinch("hold", 7)); // -9° → 누적 -8°(남은 1° 포함) → 반대로 한 칸
    expect(rotations(commands)).toEqual([15, 15, -15]);
  });

  it("손 떨림(±3°)으로는 돌지 않는다", () => {
    const { emit, commands } = setup();
    emit(pinch("start", 10));
    for (const r of [12, 8, 13, 9, 11, 7, 12]) emit(pinch("hold", r));
    expect(rotations(commands)).toEqual([]);
  });

  it("±180° 경계를 넘어도 짧은 쪽으로 계산한다", () => {
    const { emit, commands } = setup();
    emit(pinch("start", 175));
    emit(pinch("hold", -172)); // +13°
    expect(rotations(commands)).toEqual([15]);
  });

  it("놓은 뒤에는 다시 잡을 때의 각도가 새 기준이다", () => {
    const { emit, commands } = setup();
    emit(pinch("start", 0));
    emit(pinch("end", 0));
    emit(pinch("start", 40));
    emit(pinch("hold", 42));
    expect(rotations(commands)).toEqual([]);
  });
});
