import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { FALL_HZ, FALL_SECONDS, type FallInput, hashSeed, simulateFall as simulate } from "./fallEffect";

// 브라우저는 @dimforge/rapier3d(wasm 파일 분리)를 쓰고, Node 테스트는 같은 버전의 compat 빌드(wasm 내장)를 주입한다.
type Rapier = Parameters<typeof simulate>[1];
const simulateFall = (input: FallInput) => simulate(input, RAPIER as unknown as Rapier);

beforeAll(async () => {
  await RAPIER.init();
});

const GEAR = {
  start: [1.0, 0.6, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  boxMin: [-0.3, -0.05, -0.3] as [number, number, number],
  boxMax: [0.3, 0.05, 0.3] as [number, number, number],
  groundY: -0.05,
  seed: hashSeed("gear-input-12t", 1),
};

describe("simulateFall", () => {
  it("튀어 올랐다가 작업대 위로 떨어져 멈춘다", async () => {
    const frames = await simulateFall(GEAR);
    expect(frames).toHaveLength(Math.round(FALL_SECONDS * FALL_HZ));
    const ys = frames.map((f) => f.p[1]);
    expect(Math.max(...ys)).toBeGreaterThan(GEAR.start[1]); // 위로 튕김
    const last = frames.at(-1)!;
    // 바닥을 뚫지 않고 바닥 근처에 멈춤 (상자 반높이~반대각 이내)
    expect(last.p[1]).toBeGreaterThan(GEAR.groundY - 0.01);
    expect(last.p[1]).toBeLessThan(GEAR.groundY + 0.35);
    const [x, y, z, w] = last.q;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 5);
  });

  it("같은 입력이면 같은 궤적", async () => {
    const a = await simulateFall(GEAR);
    const b = await simulateFall(GEAR);
    expect(b[40]).toEqual(a[40]);
  });

  it("시드가 다르면 다르게 구른다", async () => {
    const a = await simulateFall(GEAR);
    const b = await simulateFall({ ...GEAR, seed: hashSeed("gear-input-12t", 2) });
    expect(b[30]?.q).not.toEqual(a[30]?.q);
  });
});
