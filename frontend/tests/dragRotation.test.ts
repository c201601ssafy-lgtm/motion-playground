import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { rebaseDragAfterRotation } from "../src/three/dragRotation";

describe("dragging while rotating the model", () => {
  it.each([false, true])("a stationary cursor adds no movement after rotation (tabletop=%s)", (tabletop) => {
    const rotating = new THREE.Group();
    const model = new THREE.Group();
    const part = new THREE.Group();
    rotating.add(model);
    model.position.set(-0.3, -0.1, 0.2);
    model.add(part);
    part.position.set(0.4, 0.15, -0.2);
    const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 100);
    camera.position.set(0, 2.6, 4.2);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const screen = { x: 0.45, y: 0.55 };
    const drag = { root: part, screen, plane: new THREE.Plane(), offset: new THREE.Vector3(), tabletop };
    const before = part.position.clone();
    for (const [pitch, yaw] of [[0.25, 0.4], [0.5, -0.8], [0.35, 1.1]]) {
      rotating.rotation.set(pitch!, yaw!, 0);
      rebaseDragAfterRotation(drag, model, camera);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(screen.x * 2 - 1, 1 - screen.y * 2), camera);
      const anchor = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
      expect(anchor).not.toBeNull();
      const resumed = model.worldToLocal(anchor!.add(drag.offset));
      expect(resumed.distanceTo(before)).toBeLessThan(1e-9);
      // Once the hand moves again, dragging remains responsive in the newly rotated frame.
      ray.setFromCamera(new THREE.Vector2((screen.x + 0.01) * 2 - 1, 1 - screen.y * 2), camera);
      const moved = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
      expect(model.worldToLocal(moved!.add(drag.offset)).distanceTo(before)).toBeGreaterThan(0.001);
    }
  });
});
