import * as THREE from "three";
import type { ScreenPoint } from "../features/commands/types";

export interface DragAnchor {
  root: THREE.Object3D | null;
  screen: ScreenPoint | null;
  plane: THREE.Plane;
  offset: THREE.Vector3;
  tabletop: boolean;
}

/** Rebase the drag around the rotated model, so a stationary grabbing hand adds no movement. */
export function rebaseDragAfterRotation(drag: DragAnchor, group: THREE.Object3D, camera: THREE.Camera): void {
  if (!drag.root || !drag.screen) return;
  group.updateWorldMatrix(true, true);
  const position = drag.root.getWorldPosition(new THREE.Vector3());
  const normal = drag.tabletop
    ? new THREE.Vector3(0, 1, 0).transformDirection(group.matrixWorld)
    : camera.getWorldDirection(new THREE.Vector3()).negate();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, position);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(drag.screen.x * 2 - 1, 1 - drag.screen.y * 2), camera);
  const anchor = ray.ray.intersectPlane(plane, new THREE.Vector3());
  if (!anchor) return;
  drag.plane.copy(plane);
  drag.offset.copy(position).sub(anchor);
}
