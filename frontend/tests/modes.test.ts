import { describe, expect, it } from "vitest";
import { CommandBus } from "../src/features/commands/commandBus";
import { KEY_BINDINGS, KeyboardCommandSource } from "../src/features/commands/keyboardSource";
import { MODES, modeHash, parseMode } from "../src/modes";

describe("modes", () => {
  it("parses hashes and falls back to lab", () => {
    expect(parseMode("#/assemble")).toBe("assemble");
    expect(parseMode("#operate")).toBe("operate");
    expect(parseMode("")).toBe("lab");
    expect(parseMode("#/nope")).toBe("lab");
    for (const m of MODES) expect(parseMode(modeHash(m.id))).toBe(m.id);
  });

  it("binds number keys 1..7 to SET_MODE", () => {
    expect(new Set(MODES.map((m) => m.key)).size).toBe(MODES.length);
    const bus = new CommandBus();
    const seen: unknown[] = [];
    bus.subscribe((e) => seen.push(e.command));
    const win = new EventTarget();
    new KeyboardCommandSource(win).start(bus);
    const ev = new Event("keydown");
    Object.defineProperty(ev, "key", { value: "3" });
    win.dispatchEvent(ev);
    expect(seen).toEqual([{ type: "SET_MODE", mode: "assemble" }]);
    expect(KEY_BINDINGS["]"]).toEqual({ type: "ROTATE_PART", dYawDeg: 15 });
  });
});
