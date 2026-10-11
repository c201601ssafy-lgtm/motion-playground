import type { Vec3 } from "../../types/model";

/**
 * 잘못 놓은 부품의 낙하 연출 (Rapier 강체 시뮬레이션).
 * 연출용이다. 조립 판정은 백엔드 규칙 엔진이 하고, 이 결과는 어떤 판정에도 쓰지 않는다.
 * 궤적을 미리 계산해 두고 화면에서는 재생만 한다(프레임 드롭과 무관하게 같은 움직임).
 */

export type Quat = [number, number, number, number];

export interface FallFrame {
  /** 모델 좌표계 위치 */
  p: Vec3;
  /** 회전 (x, y, z, w) */
  q: Quat;
}

export interface FallInput {
  /** 놓은 순간의 부품 원점 위치 (모델 좌표계) */
  start: Vec3;
  /** 놓은 순간의 회전 */
  rotation: Quat;
  /** 부품 원점 기준 경계 상자 (회전 전 로컬 좌표) */
  boxMin: Vec3;
  boxMax: Vec3;
  /** 바닥(작업대 윗면) 높이 */
  groundY: number;
  /** 같은 입력이면 같은 궤적이 나오도록 하는 값 */
  seed: number;
}

export const FALL_HZ = 60;
export const FALL_SECONDS = 1.2;

type Rapier = typeof import("@dimforge/rapier3d");

let rapier: Promise<Rapier> | null = null;

/** wasm(약 2MB)은 처음 쓸 때 한 번만 내려받는다. 조립 모드에 들어갈 때 미리 불러 둔다. */
export function loadRapier(): Promise<Rapier> {
  rapier ??= import("@dimforge/rapier3d");
  return rapier;
}

/** 시드에서 -1~1 사이 값 3개 (부품마다 다르게 구르도록) */
function spread(seed: number): Vec3 {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
  return [next(), next(), next()];
}

export function hashSeed(text: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export async function simulateFall(input: FallInput, R?: Rapier): Promise<FallFrame[]> {
  const RAPIER = R ?? (await loadRapier());
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    world.timestep = 1 / FALL_HZ;
    // 작업대: 윗면이 groundY인 넓은 고정 판
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, input.groundY - 0.5, 0).setFriction(0.8),
    );

    const [jx, jy, jz] = spread(input.seed);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...input.start)
        .setRotation({ x: input.rotation[0], y: input.rotation[1], z: input.rotation[2], w: input.rotation[3] })
        // 살짝 튕겨 올리고 비틀어서 "안 맞아서 튕겨 나옴"을 보여준다
        .setLinvel(jx * 0.6, 1.6 + jy * 0.3, jz * 0.6)
        .setAngvel({ x: 3 + jx * 2, y: jy * 4, z: 2.5 + jz * 2 }),
    );
    const [x0, y0, z0] = input.boxMin;
    const [x1, y1, z1] = input.boxMax;
    const half: Vec3 = [Math.max((x1 - x0) / 2, 0.01), Math.max((y1 - y0) / 2, 0.01), Math.max((z1 - z0) / 2, 0.01)];
    const center: Vec3 = [(x1 + x0) / 2, (y1 + y0) / 2, (z1 + z0) / 2];
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(...half)
        .setTranslation(...center)
        .setRestitution(0.35)
        .setFriction(0.7),
      body,
    );

    const frames: FallFrame[] = [];
    const steps = Math.round(FALL_SECONDS * FALL_HZ);
    for (let i = 0; i < steps; i++) {
      world.step();
      const t = body.translation();
      const r = body.rotation();
      frames.push({ p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] });
    }
    return frames;
  } finally {
    world.free();
  }
}
