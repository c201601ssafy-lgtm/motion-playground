import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ERROR_TITLE,
  autoAssemblySlot,
  nearestSlot,
  poseAfterAttempt,
  resultToast,
  workbenchPose,
} from "../src/features/assembly/assemblyLogic";
import type { AssemblyResult, AssemblySnapshot, ErrorType } from "../src/types/assembly";
import type { MechanismModel } from "../src/types/model";

const MODEL: MechanismModel = JSON.parse(
  readFileSync(new URL("../public/models/gearbox.json", import.meta.url), "utf8"),
);

describe("automatic nearby assembly", () => {
  const snapshot: AssemblySnapshot = { placed: {}, completed_steps: [], current_step: 1,
    parts_placed: 0, parts_total: MODEL.parts.length, is_complete: false, last_error: null };
  const base = MODEL.slots.find(s => s.accepts_part_id === "base-plate")!;
  it("captures the correct part outside the previous snap radius and tolerates tabletop height", () => {
    expect(autoAssemblySlot(MODEL, "base-plate", [base.position[0] + base.snap_radius * 1.4, base.position[1] + 0.2, base.position[2]], snapshot)).toBe(base);
    expect(autoAssemblySlot(MODEL, "base-plate", [base.position[0] + 1, base.position[1], base.position[2]], snapshot)).toBeNull();
    expect(autoAssemblySlot(MODEL, "base-plate", [base.position[0], base.position[1] + 2, base.position[2]], snapshot)).toBeNull();
  });
  it("requires a session, an empty matching slot, and the current assembly step", () => {
    expect(autoAssemblySlot(MODEL, "base-plate", base.position, null)).toBeNull();
    expect(autoAssemblySlot(MODEL, "base-plate", base.position, { ...snapshot, placed: { [base.slot_id]: "base-plate" } })).toBeNull();
    expect(autoAssemblySlot(MODEL, "base-plate", base.position, { ...snapshot, current_step: 2 })).toBeNull();
    expect(autoAssemblySlot(MODEL, "shaft-input", base.position, snapshot)).toBeNull();
  });
  it("requires parent parts and completed prerequisites", () => {
    const gear = MODEL.slots.find(s => s.accepts_part_id === "gear-input-12t")!;
    const ready = { ...snapshot, current_step: 3, completed_steps: [1, 2], placed: { "slot-shaft-a": "shaft-input" } };
    expect(autoAssemblySlot(MODEL, "gear-input-12t", gear.position, ready)).toBe(gear);
    expect(autoAssemblySlot(MODEL, "gear-input-12t", gear.position, { ...ready, placed: {} })).toBeNull();
    expect(autoAssemblySlot(MODEL, "gear-input-12t", gear.position, { ...ready, completed_steps: [1] })).toBeNull();
  });
});

const result = (patch: Partial<AssemblyResult>): AssemblyResult => ({
  is_valid: false,
  part_id: "gear-input-12t",
  target_slot: "slot-gear-a",
  error_type: null,
  message: "msg",
  distance: 0.1,
  expected_rotation: null,
  current_rotation: null,
  axis_angle_deg: null,
  snapped_position: null,
  missing_part_ids: [],
  step_completed: null,
  assembly_complete: false,
  ...patch,
});

describe("workbenchPose", () => {
  it("places every part away from all slots so nothing starts snapped", () => {
    for (const p of MODEL.parts) {
      const pos = workbenchPose(MODEL, p.part_id).position;
      const near = nearestSlot(MODEL, pos, {});
      expect(near!.inRange, p.part_id).toBe(false);
    }
  });

  it("does not overlap gears on the bench", () => {
    const gears = MODEL.parts.filter((p) => p.kind === "gear");
    const r = (id: string) => {
      const g = MODEL.parts.find((p) => p.part_id === id)!.geometry;
      return g.type === "gear" ? (g.module * (g.teeth + 2)) / 2 : 0;
    };
    for (let i = 1; i < gears.length; i++) {
      const a = workbenchPose(MODEL, gears[i - 1]!.part_id).position;
      const b = workbenchPose(MODEL, gears[i]!.part_id).position;
      expect(Math.abs(b[0] - a[0])).toBeGreaterThanOrEqual(r(gears[i - 1]!.part_id) + r(gears[i]!.part_id) - 1e-9);
    }
  });
});

describe("nearestSlot", () => {
  it("finds the closest unoccupied slot and reports range", () => {
    const n = nearestSlot(MODEL, [0.02, 0.36, 0], {});
    expect(n?.slot.slot_id).toBe("slot-gear-a");
    expect(n?.inRange).toBe(true);
    const occ = nearestSlot(MODEL, [0.02, 0.36, 0], { "slot-gear-a": "gear-input-12t" });
    expect(occ?.slot.slot_id).not.toBe("slot-gear-a");
  });
});

describe("result handling", () => {
  it("has a Korean title for every error type", () => {
    const types: ErrorType[] = [
      "UNKNOWN_PART",
      "ALREADY_PLACED",
      "TOO_FAR",
      "WRONG_SLOT",
      "SLOT_OCCUPIED",
      "MISSING_PARENT",
      "WRONG_ORDER",
      "WRONG_ORIENTATION",
    ];
    for (const t of types) {
      expect(ERROR_TITLE[t]).toMatch(/[가-힣]/);
      expect(resultToast(result({ error_type: t })).title).toBe(ERROR_TITLE[t]);
    }
  });

  it("shows expected vs current rotation for orientation errors", () => {
    const t = resultToast(result({ error_type: "WRONG_ORIENTATION", expected_rotation: 0, current_rotation: 90 }));
    expect(t.kind).toBe("error");
    expect(t.detail).toContain("90°");
  });

  it("marks success and completion", () => {
    expect(resultToast(result({ is_valid: true, step_completed: 2 })).title).toBe("2단계 완료");
    expect(resultToast(result({ is_valid: true, assembly_complete: true })).title).toBe("조립 완료!");
  });

  it("decides where the part goes after judgement", () => {
    const dropped = { position: [5, 5, 5] as [number, number, number], yaw: 30 };
    expect(poseAfterAttempt(MODEL, result({ is_valid: true }), dropped)).toBeNull();
    expect(poseAfterAttempt(MODEL, result({ error_type: "TOO_FAR" }), dropped)).toEqual(dropped);
    const back = poseAfterAttempt(MODEL, result({ error_type: "WRONG_SLOT" }), dropped)!;
    expect(back.position).toEqual(workbenchPose(MODEL, "gear-input-12t").position);
    expect(back.yaw).toBe(30);
  });
});
