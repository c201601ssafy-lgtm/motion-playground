// 백엔드 app/core/model_schema.py 와 같은 구조 (GET /api/models/{id})

export type Vec3 = [number, number, number];
export type PartKind = "base" | "shaft" | "gear" | "cover";

export type Geometry =
  | { type: "box"; size: Vec3 }
  | { type: "cylinder"; radius: number; length: number }
  | { type: "gear"; module: number; teeth: number; thickness: number; bore_radius: number };

export interface Part {
  part_id: string;
  name: string;
  kind: PartKind;
  step: number;
  mass: number;
  rotation_axis: "x" | "y" | "z";
  description: string;
  function: string;
  teeth: number | null;
  geometry: Geometry;
  collider: { type: "box" | "cylinder"; size: number[] };
  explode_offset: Vec3;
}

export interface Slot {
  slot_id: string;
  accepts_part_id: string;
  parent_part_id: string | null;
  position: Vec3;
  axis: Vec3;
  orientation_rule: "axis_only" | "axis_and_yaw";
  yaw_deg: number;
  yaw_symmetry_deg: number;
  snap_radius: number;
  meshes_with: string[];
}

export interface AssemblyStep {
  step: number;
  title: string;
  slots: string[];
  requires_steps: number[];
}

export interface MechanismModel {
  meta: {
    model_id: string;
    name: string;
    gear_module: number;
    input_part_id: string;
    output_part_id: string;
  };
  parts: Part[];
  slots: Slot[];
  steps: AssemblyStep[];
}
