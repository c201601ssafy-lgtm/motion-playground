// 작동 모드 표시 계산 (순수 함수). 회전 방향·속도는 백엔드 MechanismState 값만 쓴다.

import type { GearState, MechanismState } from "../../types/assembly";
import type { MechanismModel, Vec3 } from "../../types/model";

/** rpm → rad/s. +는 위에서 볼 때 반시계(three.js y축 양의 회전). */
export function rpmToRadPerSec(rpm: number): number {
  return (rpm * 2 * Math.PI) / 60;
}

export function spinsFromMechanism(m: MechanismState | null): Record<string, number> {
  if (!m?.operable) return {};
  return Object.fromEntries(m.gears.map((g) => [g.part_id, rpmToRadPerSec(g.rpm)]));
}

export function directionLabel(g: Pick<GearState, "rpm">): string {
  if (g.rpm === 0) return "정지";
  return g.rpm > 0 ? "↺ 반시계" : "↻ 시계";
}

export interface ContactPoint {
  key: string;
  position: Vec3;
}

/** 맞물리는 기어 쌍의 접점 (피치원이 만나는 점). 모델 데이터만으로 계산되는 기하 정보. */
export function contactPoints(model: MechanismModel): ContactPoint[] {
  const out: ContactPoint[] = [];
  const seen = new Set<string>();
  const radius = (partId: string) => {
    const g = model.parts.find((p) => p.part_id === partId)?.geometry;
    return g?.type === "gear" ? (g.module * g.teeth) / 2 : 0;
  };
  for (const a of model.slots) {
    for (const bId of a.meshes_with) {
      const key = [a.slot_id, bId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const b = model.slots.find((s) => s.slot_id === bId);
      if (!b) continue;
      const ra = radius(a.accepts_part_id);
      const rb = radius(b.accepts_part_id);
      const t = ra / (ra + rb || 1);
      out.push({
        key,
        position: [
          a.position[0] + (b.position[0] - a.position[0]) * t,
          a.position[1] + (b.position[1] - a.position[1]) * t,
          a.position[2] + (b.position[2] - a.position[2]) * t,
        ],
      });
    }
  }
  return out;
}
