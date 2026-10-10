import { Grid } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { nearestSlot } from "../features/assembly/assemblyLogic";
import { commandBus } from "../features/commands/commandBus";
import type { ScreenPoint } from "../features/commands/types";
import { useAssemblyStore } from "../store/assemblyStore";
import { type PartPose, useLabStore } from "../store/labStore";
import type { Part, Slot, Vec3 } from "../types/model";
import { PartVisual } from "./PartVisual";
import { registerSceneProbe } from "./sceneProbe";

const COVER_IDS = new Set(["top-cover"]);
export const MODEL_CENTER: Vec3 = [1.2, 0.3, 0];
const EXPLODE_SPEED = 4; // 1/s
const SNAP_RATE = 12; // 위치 보간 속도 (1/s)

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

function approach(cur: number, target: number, maxStep: number) {
  return cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), maxStep);
}

interface PartNodeProps {
  part: Part;
  slot: Slot;
  pose: PartPose | undefined;
  exploded: boolean;
  dragging: boolean;
  highlighted: boolean;
  selected: boolean;
  dimmed: boolean;
  /** 회전축(y) 기준 각속도 rad/s (작동 모드) */
  spin?: number;
}

/**
 * 부품 하나. 자세(pose)가 있으면 그 자리, 없으면 슬롯 위치 + 분해 오프셋.
 * 잡고 있을 때는 즉시 따라가고, 그 외에는 목표로 부드럽게 이동한다(스냅·복귀 애니메이션).
 */
function PartNode({ part, slot, pose, exploded, dragging, highlighted, selected, dimmed, spin = 0 }: PartNodeProps) {
  const root = useRef<THREE.Group>(null);
  const spinner = useRef<THREE.Group>(null);
  const t = useRef(exploded ? 1 : 0);
  const target = useRef(new THREE.Vector3());
  const initialized = useRef(false);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    t.current = approach(t.current, exploded ? 1 : 0, dt * EXPLODE_SPEED);
    const e = t.current * t.current * (3 - 2 * t.current); // smoothstep
    let yawDeg: number;
    if (pose) {
      target.current.set(...pose.position);
      yawDeg = pose.yaw;
    } else {
      const [ox, oy, oz] = part.explode_offset ?? [0, 0, 0];
      target.current.set(slot.position[0] + ox * e, slot.position[1] + oy * e, slot.position[2] + oz * e);
      yawDeg = slot.yaw_deg;
    }
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    if (dragging || !initialized.current) {
      g.position.copy(target.current);
      g.rotation.y = yaw;
      initialized.current = true;
    } else {
      const k = 1 - Math.exp(-dt * SNAP_RATE);
      g.position.lerp(target.current, k);
      g.rotation.y += (yaw - g.rotation.y) * k;
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

/** 드래그 중인 부품의 가장 가까운 빈 결합 지점에 반투명 고스트를 보여준다 (표시용, 판정 아님). */
function SlotGhost() {
  const model = useLabStore((s) => s.model);
  const mode = useLabStore((s) => s.mode);
  const dragging = useLabStore((s) => s.draggingPartId);
  const pose = useLabStore((s) => (s.draggingPartId ? s.poses[s.draggingPartId] : undefined));
  const placed = useAssemblyStore((s) => s.snapshot?.placed);
  const near = model && dragging && pose && mode === "assemble" ? nearestSlot(model, pose.position, placed ?? {}) : null;
  const slotId = near?.slot.slot_id;
  const distance = near?.distance;
  const inRange = near?.inRange;

  useEffect(() => {
    useLabStore
      .getState()
      .setGuide(slotId !== undefined ? { slotId, distance: distance ?? 0, inRange: !!inRange } : null);
  }, [slotId, distance, inRange]);

  if (!near || !model) return null;
  const ghostPart = model.parts.find((p) => p.part_id === dragging);
  if (!ghostPart) return null;
  return (
    <group position={near.slot.position} rotation={[0, THREE.MathUtils.degToRad(near.slot.yaw_deg), 0]}>
      <PartVisual part={ghostPart} highlighted opacity={near.inRange ? 0.45 : 0.15} />
    </group>
  );
}

/** 분해도·조립 모드에서는 화면에 다 들어오도록 축소하고 내린다. */
function Framing({ zoomOut, lift, children }: { zoomOut: number; lift: number; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  const s = useRef({ scale: 1, y: 0 });
  useFrame((_, dt) => {
    s.current.scale = approach(s.current.scale, 1 - zoomOut, dt);
    s.current.y = approach(s.current.y, lift, dt * 2);
    if (!g.current) return;
    g.current.scale.setScalar(s.current.scale);
    g.current.position.y = s.current.y;
  });
  return <group ref={g}>{children}</group>;
}

/**
 * 조립 모드 높이 보조: 빈 결합 지점 바로 위(수평 거리 ≤ 반경)에 오면 그 지점 높이로 띄운다.
 * 2D 입력으로는 높이를 정할 수 없기 때문이다. 판정은 여전히 백엔드가 한다.
 */
function tabletopHeight(local: THREE.Vector3, restY: number): number {
  const model = useLabStore.getState().model;
  const placed = useAssemblyStore.getState().snapshot?.placed ?? {};
  let best: { d: number; y: number } | null = null;
  for (const slot of model?.slots ?? []) {
    if (placed[slot.slot_id]) continue;
    const d = Math.hypot(local.x - slot.position[0], local.z - slot.position[2]);
    if (d <= slot.snap_radius && (!best || d < best.d)) best = { d, y: slot.position[1] };
  }
  return best ? best.y : restY;
}

function SceneContent() {
  const modelGroup = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const model = useLabStore((s) => s.model);
  const mode = useLabStore((s) => s.mode);
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
    registerSceneProbe(camera, modelGroup.current);
  });

  useEffect(() => {
    const ray = raycaster.current;
    const setRay = (screen: ScreenPoint) => {
      ray.setFromCamera(new THREE.Vector2(screen.x * 2 - 1, -(screen.y * 2 - 1)), camera);
    };

    const pick = (screen: ScreenPoint, skipLocked = false): Hit | null => {
      if (!modelGroup.current) return null;
      setRay(screen);
      const locked = new Set(skipLocked ? useLabStore.getState().lockedParts : []);
      const hits = ray
        .intersectObjects(modelGroup.current.children, true)
        .map((h) => ({ partId: h.object.userData.partId as string | undefined, point: h.point, object: h.object }))
        .filter((h): h is Hit => !!h.partId && !locked.has(h.partId));
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
      /** 조립 모드: 수평(작업대) 평면 위에서 끈다 (D-015) */
      tabletop: false,
    };

    const currentPose = (partId: string, root: THREE.Object3D): PartPose => {
      const s = useLabStore.getState();
      return (
        s.poses[partId] ?? { position: root.position.toArray() as Vec3, yaw: THREE.MathUtils.radToDeg(root.rotation.y) }
      );
    };

    const endDrag = () => {
      drag.partId = null;
      drag.root = null;
      useLabStore.getState().setDragging(null);
    };

    return commandBus.subscribe(({ command }) => {
      const store = useLabStore.getState();
      switch (command.type) {
        case "HOVER":
          store.setHovered(pick(command.screen)?.partId ?? null);
          break;

        case "GRAB_PART": {
          const hit = pick(command.screen, true);
          const root = findPartRoot(hit?.object ?? null);
          if (!hit || !root || store.mode === "operate") {
            // 빈 공간(또는 잠긴 부품)을 잡으면 모델 회전
            store.setSelected(pick(command.screen)?.partId ?? null);
            drag.orbitLast = command.screen;
            break;
          }
          store.setSelected(hit.partId);
          store.setDragging(hit.partId);
          drag.partId = hit.partId;
          drag.root = root;
          drag.startPose = currentPose(hit.partId, root);
          // 손 깊이(z)는 쓰지 않는다 (D-004). 조립 모드는 수평 평면, 그 외는 카메라를 향한 평면 (D-015)
          drag.tabletop = store.mode === "assemble" && !!modelGroup.current;
          const normal = drag.tabletop
            ? new THREE.Vector3(0, 1, 0).transformDirection(modelGroup.current!.matrixWorld)
            : camera.getWorldDirection(new THREE.Vector3()).negate();
          drag.plane.setFromNormalAndCoplanarPoint(normal, hit.point);
          drag.offset.copy(root.getWorldPosition(new THREE.Vector3())).sub(hit.point);
          break;
        }

        case "MOVE_PART": {
          if (drag.orbitLast) {
            store.rotate((command.screen.x - drag.orbitLast.x) * Math.PI, (command.screen.y - drag.orbitLast.y) * Math.PI);
            drag.orbitLast = command.screen;
            break;
          }
          if (!drag.partId || !drag.root || !modelGroup.current) break;
          setRay(command.screen);
          const p = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
          if (!p) break;
          const local = modelGroup.current.worldToLocal(p.add(drag.offset));
          const prev = currentPose(drag.partId, drag.root);
          if (drag.tabletop && drag.startPose) local.y = tabletopHeight(local, drag.startPose.position[1]);
          store.setPose(drag.partId, { position: local.toArray() as Vec3, yaw: prev.yaw });
          break;
        }

        case "RELEASE_PART": {
          drag.orbitLast = null;
          if (!drag.partId || !drag.root) break;
          const partId = drag.partId;
          const pose = currentPose(partId, drag.root);
          endDrag();
          store.onDrop?.({ partId, pose });
          break;
        }

        case "ROTATE_PART": {
          if (!drag.partId || !drag.root) break;
          const prev = currentPose(drag.partId, drag.root);
          store.setPose(drag.partId, { ...prev, yaw: prev.yaw + command.dYawDeg });
          break;
        }

        case "ROTATE_MODEL":
          store.rotate(command.dYaw, command.dPitch);
          break;

        case "CANCEL":
          if (drag.partId && drag.startPose) store.setPose(drag.partId, drag.startPose);
          drag.orbitLast = null;
          endDrag();
          store.setSelected(null);
          break;

        default:
          break;
      }
    });
  }, [camera]);

  if (!model) return null;
  const zoomOut = exploded ? 0.28 : mode === "assemble" ? 0.36 : 0;
  const lift = exploded ? -0.55 : mode === "assemble" ? 0.15 : 0;
  return (
    <Framing zoomOut={zoomOut} lift={lift}>
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
                dragging={dragging === part.part_id}
                highlighted={hovered === part.part_id}
                selected={selected === part.part_id || dragging === part.part_id}
                dimmed={!!focus && focus !== part.part_id}
                spin={spins[part.part_id]}
              />
            );
          })}
        </group>
        <group position={[-MODEL_CENTER[0], -MODEL_CENTER[1], -MODEL_CENTER[2]]}>
          <SlotGhost />
        </group>
      </group>
    </Framing>
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
