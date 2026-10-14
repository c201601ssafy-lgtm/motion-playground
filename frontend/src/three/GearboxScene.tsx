import { Grid } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { autoAssemblySlot, nearestSlot } from "../features/assembly/assemblyLogic";
import { FALL_HZ, type FallFrame, hashSeed, simulateFall } from "../features/assembly/fallEffect";
import { commandBus } from "../features/commands/commandBus";
import { MechanismOverlay } from "../features/simulation/MechanismOverlay";
import type { ScreenPoint } from "../features/commands/types";
import { useAssemblyStore } from "../store/assemblyStore";
import { type FallRequest, type PartPose, useLabStore } from "../store/labStore";
import type { Part, Slot, Vec3 } from "../types/model";
import { PartVisual } from "./PartVisual";
import { registerSceneProbe } from "./sceneProbe";
import { DragSessions } from "./dragSessions";
import { rebaseDragAfterRotation } from "./dragRotation";

const COVER_IDS = new Set(["top-cover"]);
export const MODEL_CENTER: Vec3 = [1.2, 0.3, 0];
const EXPLODE_SPEED = 4; // 1/s
const SNAP_RATE = 12; // 위치 보간 속도 (1/s)
const Y_AXIS = new THREE.Vector3(0, 1, 0);

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
  armed: boolean;
  selected: boolean;
  dimmed: boolean;
  /** 회전축(y) 기준 각속도 rad/s (작동 모드) */
  spin?: number;
  /** 잘못 놓았을 때의 낙하 연출 요청 */
  fall?: FallRequest;
}

/** 부품 루트 기준(회전 전) 경계 상자 */
function localBox(root: THREE.Object3D): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    box.union(b);
  });
  return box;
}

/**
 * 부품 하나. 자세(pose)가 있으면 그 자리, 없으면 슬롯 위치 + 분해 오프셋.
 * 잡고 있을 때는 즉시 따라가고, 그 외에는 목표로 부드럽게 이동한다(스냅·복귀 애니메이션).
 */
function PartNode({ part, slot, pose, exploded, dragging, highlighted, armed, selected, dimmed, spin = 0, fall }: PartNodeProps) {
  const root = useRef<THREE.Group>(null);
  const spinner = useRef<THREE.Group>(null);
  const t = useRef(exploded ? 1 : 0);
  const target = useRef(new THREE.Vector3());
  const targetQ = useRef(new THREE.Quaternion());
  const initialized = useRef(false);
  /** 낙하 연출: 계산 중이면 제자리에 멈추고, 궤적이 오면 재생한 뒤 원래 목표로 돌아간다 */
  const falling = useRef<{ pending: boolean; frames: FallFrame[] | null; t: number }>({ pending: false, frames: null, t: 0 });

  const fallNonce = fall?.nonce;
  useEffect(() => {
    const g = root.current;
    if (!fall || !g) return;
    const box = localBox(g);
    const f = falling.current;
    f.pending = true;
    f.frames = null;
    let cancelled = false;
    simulateFall({
      start: g.position.toArray() as Vec3,
      rotation: g.quaternion.toArray() as [number, number, number, number],
      boxMin: box.min.toArray() as Vec3,
      boxMax: box.max.toArray() as Vec3,
      groundY: fall.restY + box.min.y,
      seed: hashSeed(part.part_id, fall.nonce),
    })
      .then((frames) => {
        if (!cancelled) Object.assign(f, { frames, t: 0 });
      })
      .catch(() => undefined) // 물리 엔진을 못 불러오면 연출 없이 바로 돌아간다
      .finally(() => {
        f.pending = false;
      });
    return () => {
      cancelled = true;
      f.pending = false;
      f.frames = null;
    };
    // fall 객체가 아니라 nonce가 바뀔 때만 재생한다
  }, [fallNonce, part.part_id]);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const f = falling.current;
    if (!dragging && f.frames) {
      f.t += dt;
      const frame = f.frames[Math.floor(f.t * FALL_HZ)];
      if (frame) {
        g.position.set(...frame.p);
        g.quaternion.set(...frame.q);
        return;
      }
      f.frames = null;
    }
    if (!dragging && f.pending) return;
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
    // 낙하 후에는 x·z축으로도 기울어 있으므로 회전은 쿼터니언으로 보간한다
    targetQ.current.setFromAxisAngle(Y_AXIS, THREE.MathUtils.degToRad(yawDeg));
    if (dragging || !initialized.current) {
      g.position.copy(target.current);
      g.quaternion.copy(targetQ.current);
      initialized.current = true;
    } else {
      const k = 1 - Math.exp(-dt * SNAP_RATE);
      g.position.lerp(target.current, k);
      g.quaternion.slerp(targetQ.current, k);
    }
    if (spinner.current) spinner.current.rotation.y += spin * dt;
  });

  return (
    <group ref={root} userData={{ partRoot: true, partId: part.part_id }}>
      <group ref={spinner}>
        <PartVisual part={part} highlighted={highlighted} armed={armed} selected={selected} opacity={dimmed ? 0.18 : 1} />
      </group>
    </group>
  );
}

/** 드래그 중인 부품의 가장 가까운 빈 결합 지점에 반투명 고스트를 보여준다 (표시용, 판정 아님). */
function SlotGhost({ owner }: { owner: string }) {
  const model = useLabStore((s) => s.model);
  const mode = useLabStore((s) => s.mode);
  const dragging = useLabStore((s) => s.interactions[owner]?.dragging ?? null);
  const pose = useLabStore((s) => dragging ? s.poses[dragging] : undefined);
  const placed = useAssemblyStore((s) => s.snapshot?.placed);
  const near = model && dragging && pose && mode === "assemble" ? nearestSlot(model, pose.position, placed ?? {}) : null;
  const slotId = near?.slot.slot_id;
  const distance = near?.distance;
  const inRange = near?.inRange;

  useEffect(() => {
    useLabStore.getState().setInteractionGuide(owner,
      slotId !== undefined ? { slotId, distance: distance ?? 0, inRange: !!inRange } : null);
    return () => useLabStore.getState().setInteractionGuide(owner, null);
  }, [owner, slotId, distance, inRange]);

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
  const { camera, size } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const model = useLabStore((s) => s.model);
  const mode = useLabStore((s) => s.mode);
  const yaw = useLabStore((s) => s.yaw);
  const pitch = useLabStore((s) => s.pitch);
  const hovered = useLabStore((s) => s.hoveredPartId);
  const selected = useLabStore((s) => s.selectedPartId);
  const dragging = useLabStore((s) => s.draggingPartId);
  const interactions = useLabStore((s) => s.interactions);
  const poses = useLabStore((s) => s.poses);
  const hidden = useLabStore((s) => s.hiddenParts);
  const exploded = useLabStore((s) => s.exploded);
  const focus = useLabStore((s) => s.focusPartId);
  const spins = useLabStore((s) => s.spins);
  const falls = useLabStore((s) => s.falls);

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
      const state = useLabStore.getState();
      const locked = new Set(skipLocked ? [...state.lockedParts, ...state.pendingParts] : []);
      const hits = ray
        .intersectObjects(modelGroup.current.children, true)
        .map((h) => ({ partId: h.object.userData.partId as string | undefined, point: h.point, object: h.object }))
        .filter((h): h is Hit => !!h.partId && !locked.has(h.partId));
      // 반투명 커버 뒤의 부품을 우선 선택
      return hits.find((h) => !COVER_IDS.has(h.partId)) ?? hits[0] ?? null;
    };

    const createDrag = () => ({
      plane: new THREE.Plane(),
      offset: new THREE.Vector3(),
      root: null as THREE.Object3D | null,
      partId: null as string | null,
      startPose: null as PartPose | null,
      orbitLast: null as ScreenPoint | null,
      screen: null as ScreenPoint | null,
      /** 조립 모드: 수평(작업대) 평면 위에서 끈다 (D-015) */
      tabletop: false,
    });
    type Drag = ReturnType<typeof createDrag>;
    const drags = new DragSessions(createDrag);
    const rotateModel = (dYaw: number, dPitch: number) => {
      useLabStore.getState().rotate(dYaw, dPitch);
      const group = modelGroup.current;
      if (!group?.parent) return;
      const view = useLabStore.getState();
      // Apply the new transform before processing another hand's move in the same video frame.
      group.parent.rotation.set(view.pitch, view.yaw, 0);
      for (const session of drags.values()) {
        if (!session.partId || !session.root) continue;
        const pose = view.poses[session.partId];
        if (pose) {
          session.root.position.set(...pose.position);
          session.root.rotation.set(0, THREE.MathUtils.degToRad(pose.yaw), 0);
        }
      }
      group.updateWorldMatrix(true, true);
      for (const session of drags.values()) if (session.partId) rebaseDragAfterRotation(session, group, camera);
    };

    const currentPose = (partId: string, root: THREE.Object3D): PartPose => {
      const s = useLabStore.getState();
      return (
        s.poses[partId] ?? { position: root.position.toArray() as Vec3, yaw: THREE.MathUtils.radToDeg(root.rotation.y) }
      );
    };

    const endDrag = (owner: string, drag: Drag) => {
      drag.partId = null;
      drag.root = null;
      drag.screen = null;
      useLabStore.getState().setInteraction(owner, { dragging: null });
    };

    const gestureHovers = new Map<string, Hit | null>();
    const pickGesture = (screen: ScreenPoint): Hit | null => {
      const direct = pick(screen, true);
      if (direct) return direct;
      // 작은 부품도 겨냥할 수 있도록 화면에서 10px 안쪽만 보조한다.
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const hit = pick({ x: screen.x + dx! * 10 / size.width, y: screen.y + dy! * 10 / size.height }, true);
        if (hit) return hit;
      }
      return null;
    };

    const unsubscribe = commandBus.subscribe(({ command, source }) => {
      const store = useLabStore.getState();
      const owner = command.hand ?? "pointer";
      const drag = drags.get(owner);
      switch (command.type) {
        case "LOCK_SELECTION":
          store.setInteraction(owner, { armed: command.locked && !!gestureHovers.get(owner) });
          break;
        case "HOVER":
          if (store.interactions[owner]?.armed) break;
          if (source === "gesture") {
            const hit = pickGesture(command.screen);
            gestureHovers.set(owner, hit);
            store.setInteraction(owner, { hovered: hit?.partId ?? null });
          } else store.setInteraction(owner, { hovered: pick(command.screen)?.partId ?? null });
          break;

        case "GRAB_PART": {
          if (drag.partId) break;
          const cached = command.useHovered ? gestureHovers.get(owner) : null;
          const hit = command.useHovered
            ? cached && !store.lockedParts.includes(cached.partId) && !store.pendingParts.includes(cached.partId) && !store.hiddenParts.includes(cached.partId) ? cached : null
            : pick(command.screen, true);
          const root = findPartRoot(hit?.object ?? null);
          if (!hit || !root || store.mode === "operate") {
            if (source === "gesture") break;
            // 빈 공간(또는 잠긴 부품)을 잡으면 모델 회전
            store.setInteraction(owner, { selected: pick(command.screen)?.partId ?? null });
            drag.orbitLast = command.screen;
            break;
          }
          if (!drags.claim(owner, hit.partId)) break;
          store.setInteraction(owner, { selected: hit.partId, dragging: hit.partId });
          drag.root = root;
          drag.screen = command.screen;
          drag.startPose = currentPose(hit.partId, root);
          // 손 깊이(z)는 쓰지 않는다 (D-004). 조립 모드는 수평 평면, 그 외는 카메라를 향한 평면 (D-015)
          drag.tabletop = store.mode === "assemble" && !!modelGroup.current;
          const normal = drag.tabletop
            ? new THREE.Vector3(0, 1, 0).transformDirection(modelGroup.current!.matrixWorld)
            : camera.getWorldDirection(new THREE.Vector3()).negate();
          drag.plane.setFromNormalAndCoplanarPoint(normal, hit.point);
          setRay(command.screen);
          const anchor = ray.ray.intersectPlane(drag.plane, new THREE.Vector3()) ?? hit.point;
          drag.offset.copy(root.getWorldPosition(new THREE.Vector3())).sub(anchor);
          break;
        }

        case "MOVE_PART": {
          if (drag.orbitLast) {
            rotateModel((command.screen.x - drag.orbitLast.x) * Math.PI, (command.screen.y - drag.orbitLast.y) * Math.PI);
            drag.orbitLast = command.screen;
            break;
          }
          if (!drag.partId || !drag.root || !modelGroup.current) break;
          setRay(command.screen);
          const p = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
          if (!p) break;
          drag.screen = command.screen;
          const local = modelGroup.current.worldToLocal(p.add(drag.offset));
          const prev = currentPose(drag.partId, drag.root);
          if (drag.tabletop && drag.startPose) local.y = tabletopHeight(local, drag.startPose.position[1]);
          const pose = { position: local.toArray() as Vec3, yaw: prev.yaw };
          const slot = store.mode === "assemble" && store.model && store.onDrop
            ? autoAssemblySlot(store.model, drag.partId, pose.position, useAssemblyStore.getState().snapshot) : null;
          if (slot) {
            const partId = drag.partId;
            const snapped = { position: [...slot.position] as Vec3, yaw: slot.yaw_deg };
            endDrag(owner, drag);
            store.setPose(partId, snapped);
            store.onDrop?.({ partId, pose: snapped });
          } else store.setPose(drag.partId, pose);
          break;
        }

        case "RELEASE_PART": {
          drag.orbitLast = null;
          if (!drag.partId || !drag.root) break;
          const partId = drag.partId;
          const pose = currentPose(partId, drag.root);
          endDrag(owner, drag);
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
          if (!drags.canRotate(source === "gesture" ? command.hand ?? null : null)) break;
          if (source === "gesture" && !store.handRotationAllowed) break;
          rotateModel(command.dYaw, command.dPitch);
          break;

        case "CANCEL":
          for (const [key, session] of command.hand ? [[owner, drag] as const] : [...drags]) {
            if (session.partId && session.startPose) store.setPose(session.partId, session.startPose);
            session.orbitLast = null;
            endDrag(key, session);
            store.setInteraction(key, { selected: null, hovered: null, armed: false });
            gestureHovers.delete(key);
          }
          if (!command.hand) store.setSelected(null);
          break;

        default:
          break;
      }
    });
    return () => {
      unsubscribe();
      for (const [owner, drag] of drags) {
        if (drag.partId && drag.startPose) useLabStore.getState().setPose(drag.partId, drag.startPose);
        useLabStore.getState().setInteraction(owner, { hovered: null, selected: null, dragging: null, armed: false });
      }
    };
  }, [camera, size, mode]);

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
                dragging={dragging === part.part_id || Object.values(interactions).some((v) => v.dragging === part.part_id)}
                highlighted={hovered === part.part_id || Object.values(interactions).some((v) => v.hovered === part.part_id)}
                armed={Object.values(interactions).some((v) => v.armed && v.hovered === part.part_id)}
                selected={selected === part.part_id || Object.values(interactions).some((v) => v.selected === part.part_id || v.dragging === part.part_id)}
                dimmed={!!focus && focus !== part.part_id}
                spin={spins[part.part_id]}
                fall={falls[part.part_id]}
              />
            );
          })}
        </group>
        <group position={[-MODEL_CENTER[0], -MODEL_CENTER[1], -MODEL_CENTER[2]]}>
          {(["left", "right", "pointer"] as const).map((owner) => <SlotGhost key={owner} owner={owner} />)}
          <MechanismOverlay />
        </group>
      </group>
    </Framing>
  );
}

function HandCursorOverlay() {
  const cursors = useLabStore((s) => s.handCursors);
  return <>{(["left", "right"] as const).map((hand) => {
  const cursor = cursors[hand];
  if (!cursor) return null;
  const color = cursor.gesture === "FIST" ? "#f85149" : hand === "left" ? "#58a6ff" : "#f2cc60";
  return (
    <div
      key={hand}
      data-testid="hand-cursor"
      data-hand={hand}
      style={{
        position: "absolute",
        left: `${cursor.screen.x * 100}%`,
        top: `${cursor.screen.y * 100}%`,
        width: cursor.gesture === "PINCH" ? 18 : 30,
        height: cursor.gesture === "PINCH" ? 18 : 30,
        transform: "translate(-50%, -50%)",
        borderRadius: "50%",
        border: `3px ${cursor.selectionLocked ? "dashed" : "solid"} ${cursor.selectionLocked ? "#d2a8ff" : color}`,
        background: `${color}33`,
        pointerEvents: "none",
        transition: "width 80ms, height 80ms",
      }}
    >
      <span style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", color, whiteSpace: "nowrap", fontSize: 12 }}>
        {hand === "left" ? "왼손" : "오른손"} {cursor.selectionLocked ? "집기 준비" : cursor.gesture === "PINCH" ? "집기" : cursor.gesture === "POINT" ? "선택" : ""}
      </span>
    </div>
  );
  })}</>;
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
