// 디버그·스모크 테스트용: 모델 좌표 → 캔버스 화면 좌표(0..1) 투영.

import * as THREE from "three";
import type { Vec3 } from "../types/model";

let camera: THREE.Camera | null = null;
let modelGroup: THREE.Object3D | null = null;

export function registerSceneProbe(c: THREE.Camera, group: THREE.Object3D | null) {
  camera = c;
  modelGroup = group;
}

/** 모델 좌표계의 점을 화면 좌표로. */
export function projectModelPoint(p: Vec3): { x: number; y: number } | null {
  if (!camera || !modelGroup) return null;
  const v = modelGroup.localToWorld(new THREE.Vector3(...p)).project(camera);
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
}

/** 그려지고 있는 부품의 현재 위치를 화면 좌표로. */
export function projectPart(partId: string): { x: number; y: number } | null {
  if (!camera || !modelGroup) return null;
  let found: THREE.Object3D | null = null;
  modelGroup.traverse((o) => {
    if (!found && o.userData.partRoot && o.userData.partId === partId) found = o;
  });
  if (!found) return null;
  const v = (found as THREE.Object3D).getWorldPosition(new THREE.Vector3()).project(camera);
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
}

/** 부품을 이루는 메시 (이름, 형상 종류). GLB 교체 확인용. */
export function partMeshes(partId: string): { name: string; geometry: string }[] {
  const out: { name: string; geometry: string }[] = [];
  modelGroup?.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.partId === partId) out.push({ name: mesh.name, geometry: mesh.geometry.type });
  });
  return out;
}
