import { Grid } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { commandBus } from "../features/commands/commandBus";
import type { ScreenPoint } from "../features/commands/types";
import { type PartPose, useLabStore } from "../store/labStore";
import type { Part, Slot, Vec3 } from "../types/model";
import { PartVisual } from "./PartVisual";

const COVER_IDS = new Set(["top-cover"]);
export const MODEL_CENTER: Vec3 = [1.2, 0.3, 0];

interface Hit {
  partId: string;
  point: THREE.Vector3;
  object: THREE.Object3D;
}

/** 부품 하나를 그리는 위치 그룹. userData.partRoot로 드래그 대상 식별. */
function findPartRoot(obj: THREE.Object3D | null): THREE.Object3D | null {
  let o = obj;
  while (o && !o.userData.partRoot) o = o.parent;
  return o;
}

const EXPLODE_SPEED = 4; // 1/s

interface PartNodeProps {
  part: Part;
  slot: Slot;
  pose: PartPose | undefined;
  exploded: boolean;
  highlighted: boolean;
  selected: boolean;
  dimmed: boolean;
  /** 회전축(y) 기준 각속도 rad/s (작동 모드) */
  spin?: number;
}

/** 부품 하나. 자세가 지정되지 않으면 슬롯 위치 + 분해 오프셋(애니메이션)에 놓인다. */
function PartNode({ part, slot, pose, exploded, highlighted, selected, dimmed, spin = 0 }: PartNodeProps) {
  const root = useRef<THREE.Group>(null);
  const spinner = useRef<THREE.Group>(null);
  const t = useRef(exploded ? 1 : 0);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const target = exploded ? 1 : 0;
    t.current += Math.sign(target - t.current) * Math.min(Math.abs(target - t.current), dt * EXPLODE_SPEED);
    const e = t.current * t.current * (3 - 2 * t.current); // smoothstep
    if (pose) {
      g.position.set(...pose.position);
      g.rotation.y = THREE.MathUtils.degToRad(pose.yaw);
    } else {
      const [ox, oy, oz] = part.explode_offset ?? [0, 0, 0];
      g.position.set(slot.position[0] + ox * e, slot.position[1] + oy * e, slot.position[2] + oz * e);
      g.rotation.y = THREE.MathUtils.degToRad(slot.yaw_deg);
    }
    if (spinner.current) spinner.current.rotation.y += spin * dt;
  });

  return (
    <group ref={root} userData={{ partRoot: true, partId: part.part_id }}>
      <group ref={spinner}>
        <PartVisual part={part} highlighted={highlighted} selected={selected} opacity={dimmed ? 0.18 : 1} />
      </group>
    </group>
  );
}

/** 분해도에서는 위로 펼쳐진 부품이 화면에 들어오도록 축소하고 내린다. */
function ExplodeFraming({ exploded, children }: { exploded: boolean; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  const t = useRef(exploded ? 1 : 0);
  useFrame((_, dt) => {
    const target = exploded ? 1 : 0;
    t.current += Math.sign(target - t.current) * Math.min(Math.abs(target - t.current), dt * EXPLODE_SPEED);
    if (!g.current) return;
    g.current.scale.setScalar(1 - 0.28 * t.current);
    g.current.position.y = -0.55 * t.current;
  });
  return <group ref={g}>{children}</group>;
}

function SceneContent() {
  const modelGroup = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const model = useLabStore((s) => s.model);
  const yaw = useLabStore((s) => s.yaw);
  const pitch = useLabStore((s) => s.pitch);
  const hovered = useLabStore((s) => s.hoveredPartId);
  const selected = useLabStore((s) => s.selectedPartId);
  const dragging = useLabStore((s) => s.draggingPartId);
  const poses = useLabStore((s) => s.poses);
  const hidden = useLabStore((s) => s.hiddenParts);
  const exploded = useLabStore((s) => s.exploded);
  const focus = useLabStore((s) => s.focusPartId);
  const spins = useLabStore((s) => s.spins);

  useEffect(() => {
    const ray = raycaster.current;
    const setRay = (screen: ScreenPoint) => {
      ray.setFromCamera(new THREE.Vector2(screen.x * 2 - 1, -(screen.y * 2 - 1)), camera);
    };

    const pick = (screen: ScreenPoint): Hit | null => {
      if (!modelGroup.current) return null;
      setRay(screen);
      const hits = ray
        .intersectObjects(modelGroup.current.children, true)
        .map((h) => ({ partId: h.object.userData.partId as string | undefined, point: h.point, object: h.object }))
        .filter((h): h is Hit => !!h.partId);
      // 반투명 커버 뒤의 부품을 우선 선택
      return hits.find((h) => !COVER_IDS.has(h.partId)) ?? hits[0] ?? null;
    };

    const drag = {
      plane: new THREE.Plane(),
      offset: new THREE.Vector3(),
      root: null as THREE.Object3D | null,
      partId: null as string | null,
      startPose: null as PartPose | null,
      orbitLast: null as ScreenPoint | null,
    };

    const currentPose = (partId: string, root: THREE.Object3D): PartPose => {
      const s = useLabStore.getState();
      return (
        s.poses[partId] ?? { position: root.position.toArray() as Vec3, yaw: THREE.MathUtils.radToDeg(root.rotation.y) }
      );
    };

    return commandBus.subscribe(({ command }) => {
      const store = useLabStore.getState();
      switch (command.type) {
        case "HOVER":
          store.setHovered(pick(command.screen)?.partId ?? null);
          break;

        case "GRAB_PART": {
          const hit = pick(command.screen);
          const root = findPartRoot(hit?.object ?? null);
          if (!hit || !root) {
            // 빈 공간을 잡으면 모델 회전
            store.setSelected(null);
            drag.orbitLast = command.screen;
            break;
          }
          store.setSelected(hit.partId);
          store.setDragging(hit.partId);
          drag.partId = hit.partId;
          drag.root = root;
          drag.startPose = currentPose(hit.partId, root);
          // 카메라를 향한 평면 위에서만 움직인다 (손 깊이(z)는 쓰지 않음, D-004)
          const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
          drag.plane.setFromNormalAndCoplanarPoint(normal, hit.point);
          drag.offset.copy(root.getWorldPosition(new THREE.Vector3())).sub(hit.point);
          break;
        }

        case "MOVE_PART": {
          if (drag.orbitLast) {
            store.rotate(
              (command.screen.x - drag.orbitLast.x) * Math.PI,
              (command.screen.y - drag.orbitLast.y) * Math.PI,
            );
            drag.orbitLast = command.screen;
            break;
          }
          if (!drag.partId || !drag.root || !modelGroup.current) break;
          setRay(command.screen);
          const p = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
          if (!p) break;
          const local = modelGroup.current.worldToLocal(p.add(drag.offset));
          const prev = currentPose(drag.partId, drag.root);
          store.setPose(drag.partId, { position: local.toArray() as Vec3, yaw: prev.yaw });
          break;
        }

        case "RELEASE_PART": {
          drag.orbitLast = null;
          if (!drag.partId || !drag.root) break;
          const pose = currentPose(drag.partId, drag.root);
          store.setDragging(null);
          store.onDrop?.({ partId: drag.partId, pose });
          drag.partId = null;
          drag.root = null;
          break;
        }

        case "ROTATE_MODEL":
          store.rotate(command.dYaw, command.dPitch);
          break;

        case "CANCEL":
          if (drag.partId && drag.startPose) store.setPose(drag.partId, drag.startPose);
          drag.partId = null;
          drag.root = null;
          drag.orbitLast = null;
          store.setDragging(null);
          store.setSelected(null);
          break;

        default:
          break;
      }
    });
  }, [camera]);

  if (!model) return null;
  return (
    <ExplodeFraming exploded={exploded}>
      <group rotation={[pitch, yaw, 0]}>
        <group ref={modelGroup} position={[-MODEL_CENTER[0], -MODEL_CENTER[1], -MODEL_CENTER[2]]}>
          {model.slots.map((slot) => {
            const part = model.parts.find((p) => p.part_id === slot.accepts_part_id);
            if (!part || hidden.includes(part.part_id)) return null;
            return (
              <PartNode
                key={slot.slot_id}
                part={part}
                slot={slot}
                pose={poses[part.part_id]}
                exploded={exploded}
                highlighted={hovered === part.part_id}
                selected={selected === part.part_id || dragging === part.part_id}
                dimmed={!!focus && focus !== part.part_id}
                spin={spins[part.part_id]}
              />
            );
          })}
        </group>
      </group>
    </ExplodeFraming>
  );
}

function HandCursorOverlay() {
  const cursor = useLabStore((s) => s.cursor);
  if (!cursor) return null;
  const color = cursor.gesture === "PINCH" ? "#3fb950" : cursor.gesture === "FIST" ? "#f85149" : "#58a6ff";
  return (
    <div
      data-testid="hand-cursor"
      style={{
        position: "absolute",
        left: `${cursor.screen.x * 100}%`,
        top: `${cursor.screen.y * 100}%`,
        width: cursor.gesture === "PINCH" ? 18 : 30,
        height: cursor.gesture === "PINCH" ? 18 : 30,
        transform: "translate(-50%, -50%)",
        borderRadius: "50%",
        border: `3px solid ${color}`,
        background: `${color}33`,
        pointerEvents: "none",
        transition: "width 80ms, height 80ms",
      }}
    />
  );
}

export function GearboxScene({ onCanvas }: { onCanvas?: (el: HTMLCanvasElement) => void }) {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas shadows camera={{ position: [0, 2.6, 4.2], fov: 45 }} onCreated={({ gl }) => onCanvas?.(gl.domElement)}>
        <color attach="background" args={["#0d1117"]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[3, 6, 4]} intensity={1.6} castShadow />
        <directionalLight position={[-4, 3, -2]} intensity={0.4} />
        <Grid
          position={[0, -0.8, 0]}
          args={[20, 20]}
          cellColor="#30363d"
          sectionColor="#484f58"
          fadeDistance={18}
          infiniteGrid
        />
        <SceneContent />
      </Canvas>
      <HandCursorOverlay />
    </div>
  );
}
