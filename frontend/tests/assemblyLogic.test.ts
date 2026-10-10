import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ERROR_TITLE,
  nearestSlot,
  poseAfterAttempt,
  resultToast,
  workbenchPose,
} from "../src/features/assembly/assemblyLogic";
import type { AssemblyResult, ErrorType } from "../src/types/assembly";
import type { MechanismModel } from "../src/types/model";

const MODEL: MechanismModel = JSON.parse(
  readFileSync(new URL("../public/models/gearbox.json", import.meta.url), "utf8"),
);

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
