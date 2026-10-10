import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contactPoints,
  directionLabel,
  rpmToRadPerSec,
  spinsFromMechanism,
} from "../src/features/simulation/mechanismView";
import type { MechanismState } from "../src/types/assembly";
import type { MechanismModel } from "../src/types/model";

const MODEL: MechanismModel = JSON.parse(
  readFileSync(new URL("../public/models/gearbox.json", import.meta.url), "utf8"),
);

const mech: MechanismState = {
  operable: true,
  reasons: [],
  input_rpm: 30,
  reduction_ratio: 3,
  gears: [
    { part_id: "gear-input-12t", teeth: 12, direction: 1, speed_ratio: 1, rpm: 30 },
    { part_id: "gear-idler-24t", teeth: 24, direction: -1, speed_ratio: 0.5, rpm: -15 },
    { part_id: "gear-output-36t", teeth: 36, direction: 1, speed_ratio: 1 / 3, rpm: 10 },
  ],
};

describe("mechanism view", () => {
  it("converts backend rpm to angular speed without recomputing ratios", () => {
    const spins = spinsFromMechanism(mech);
    expect(spins["gear-input-12t"]).toBeCloseTo(Math.PI);
    expect(spins["gear-idler-24t"]).toBeCloseTo(-Math.PI / 2);
    expect(spins["gear-output-36t"]).toBeCloseTo(rpmToRadPerSec(10));
    expect(spinsFromMechanism({ ...mech, operable: false })).toEqual({});
  });

  it("labels directions", () => {
    expect(directionLabel({ rpm: 10 })).toContain("반시계");
    expect(directionLabel({ rpm: -10 })).toContain("시계");
    expect(directionLabel({ rpm: 0 })).toBe("정지");
  });

  it("puts contact points on the pitch circles between meshing gears", () => {
    const cps = contactPoints(MODEL);
    expect(cps).toHaveLength(2);
    const xs = cps.map((c) => c.position[0]).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0.3); // 12T 피치 반지름
    expect(xs[1]).toBeCloseTo(0.9 + 0.6); // 아이들러 중심 + 24T 피치 반지름
  });
});
