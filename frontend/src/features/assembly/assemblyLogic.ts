// 조립 모드 보조 로직 (순수 함수). 판정은 하지 않는다 — 판정은 백엔드 AssemblyEngine만 한다.

import type { PartPose } from "../../store/labStore";
import type { AssemblyResult, ErrorType } from "../../types/assembly";
import type { MechanismModel, Part, Slot, Vec3 } from "../../types/model";

/** 작업대(조립 전 부품 놓는 곳) 배치. 모델 좌표계. */
export function workbenchPose(model: MechanismModel, partId: string): PartPose {
  const part = model.parts.find((p) => p.part_id === partId);
  if (!part) return { position: [0, 0, 2], yaw: 0 };
  // 조립 영역(x 0~2.4, z 0) 뒤쪽에 판, 앞쪽에 기어, 왼쪽 앞에 축 (화면 좌우 HUD 패널을 피함)
  if (part.kind === "base") return { position: [1.2, -0.05, -1.75], yaw: 0 };
  if (part.kind === "cover") return { position: [1.2, 0.12, -1.75], yaw: 0 };
  const same = model.parts.filter((p) => p.kind === part.kind);
  const i = same.findIndex((p) => p.part_id === partId);
  if (part.kind === "shaft") return { position: [-1.0 + i * 0.35, restHeight(part), 0.75], yaw: 0 };
  const GEAR_X = [-0.1, 1.05, 2.75];
  return { position: [GEAR_X[i] ?? -0.1 + i * 1.4, restHeight(part), 1.45], yaw: 0 };
}

function restHeight(part: Part): number {
  const g = part.geometry;
  if (g.type === "cylinder") return g.length / 2;
  if (g.type === "gear") return g.thickness / 2;
  return g.size[1] / 2;
}

export interface NearestSlot {
  slot: Slot;
  distance: number;
  inRange: boolean;
}

/** 표시용: 가장 가까운 결합 지점 (판정 아님). */
export function nearestSlot(model: MechanismModel, position: Vec3, occupied: Record<string, string>): NearestSlot | null {
  let best: NearestSlot | null = null;
  for (const slot of model.slots) {
    if (occupied[slot.slot_id]) continue;
    const d = Math.hypot(position[0] - slot.position[0], position[1] - slot.position[1], position[2] - slot.position[2]);
    if (!best || d < best.distance) best = { slot, distance: d, inRange: d <= slot.snap_radius };
  }
  return best;
}

export const ERROR_TITLE: Record<ErrorType, string> = {
  UNKNOWN_PART: "알 수 없는 부품",
  ALREADY_PLACED: "이미 조립됨",
  TOO_FAR: "결합 지점에서 멂",
  WRONG_SLOT: "다른 부품의 자리",
  SLOT_OCCUPIED: "이미 차 있는 자리",
  MISSING_PARENT: "받침 부품 먼저",
  WRONG_ORDER: "조립 순서 틀림",
  WRONG_ORIENTATION: "방향 틀림",
};

export interface Toast {
  kind: "success" | "error" | "info";
  title: string;
  message: string;
  detail?: string;
}

export function resultToast(r: AssemblyResult): Toast {
  if (r.is_valid) {
    return {
      kind: "success",
      title: r.assembly_complete ? "조립 완료!" : r.step_completed ? `${r.step_completed}단계 완료` : "결합 성공",
      message: r.message,
    };
  }
  const details: string[] = [];
  if (r.expected_rotation !== null && r.current_rotation !== null) {
    details.push(`기대 방향 ${r.expected_rotation}° · 현재 ${Math.round(r.current_rotation)}°`);
  }
  if (r.axis_angle_deg !== null && r.error_type === "WRONG_ORIENTATION" && r.expected_rotation === null) {
    details.push(`축 기울기 ${Math.round(r.axis_angle_deg)}°`);
  }
  if (r.distance !== null && r.error_type === "TOO_FAR") details.push(`가장 가까운 결합 지점까지 ${r.distance.toFixed(2)}`);
  return {
    kind: r.error_type === "TOO_FAR" ? "info" : "error",
    title: r.error_type ? ERROR_TITLE[r.error_type] : "조립 실패",
    message: r.message,
    detail: details.join(" · ") || undefined,
  };
}

/** 판정 후 부품을 둘 곳: 성공=슬롯(자세 해제), TOO_FAR=놓은 자리, 그 외=작업대 복귀. */
export function poseAfterAttempt(model: MechanismModel, r: AssemblyResult, dropped: PartPose): PartPose | null {
  if (r.is_valid) return null;
  if (r.error_type === "TOO_FAR") return dropped;
  return { ...workbenchPose(model, r.part_id), yaw: dropped.yaw };
}
