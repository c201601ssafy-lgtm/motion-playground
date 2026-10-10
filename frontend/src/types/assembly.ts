// 백엔드 app/assembly/schemas.py 와 같은 구조.

import type { Vec3 } from "./model";

export type ErrorType =
  | "UNKNOWN_PART"
  | "ALREADY_PLACED"
  | "TOO_FAR"
  | "WRONG_SLOT"
  | "SLOT_OCCUPIED"
  | "MISSING_PARENT"
  | "WRONG_ORDER"
  | "WRONG_ORIENTATION";

export interface AssemblyResult {
  is_valid: boolean;
  part_id: string;
  target_slot: string | null;
  error_type: ErrorType | null;
  message: string;
  distance: number | null;
  expected_rotation: number | null;
  current_rotation: number | null;
  axis_angle_deg: number | null;
  snapped_position: Vec3 | null;
  missing_part_ids: string[];
  step_completed: number | null;
  assembly_complete: boolean;
}

export interface AssemblySnapshot {
  placed: Record<string, string>;
  completed_steps: number[];
  current_step: number | null;
  parts_placed: number;
  parts_total: number;
  is_complete: boolean;
  last_error: AssemblyResult | null;
}

export interface SessionOut {
  session_id: string;
  model_id: string;
  snapshot: AssemblySnapshot;
}

export interface GearState {
  part_id: string;
  teeth: number;
  direction: 1 | -1;
  speed_ratio: number;
  rpm: number;
}

export interface MechanismState {
  operable: boolean;
  reasons: string[];
  input_rpm: number;
  reduction_ratio: number | null;
  gears: GearState[];
}
