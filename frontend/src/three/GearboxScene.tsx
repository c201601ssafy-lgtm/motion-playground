import { Canvas, useThree } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { commandBus } from "../features/commands/commandBus";
import type { ScreenPoint } from "../features/commands/types";
import { useLabStore } from "../store/labStore";
import { PartVisual } from "./PartVisual";

const COVER_IDS = new Set(["top-cover"]);
const MODEL_CENTER = new THREE.Vector3(1.2, 0.3, 0);

/** 화면 좌표(0..1) → 부품 raycast. */
function usePartPicker(group: React.RefObject<THREE.Group | null>) {
  const { camera } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  return (screen: ScreenPoint): string | null => {
    if (!group.current) return null;
    const ndc = new THREE.Vector2(screen.x * 2 - 1, -(screen.y * 2 - 1));
    raycaster.current.setFromCamera(ndc, camera);
    const ids = raycaster.current
      .intersectObjects(group.current.children, true)
      .map((h) => h.object.userData.partId as string | undefined)
      .filter((id): id is string => !!id);
    // 반투명 커버 뒤의 부품을 우선 선택
    return ids.find((id) => !COVER_IDS.has(id)) ?? ids[0] ?? null;
  };
}

function SceneContent() {
  const group = useRef<THREE.Group>(null);
  const pick = usePartPicker(group);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const model = useLabStore((s) => s.model);
  const yaw = useLabStore((s) => s.yaw);
  const pitch = useLabStore((s) => s.pitch);
  const hovered = useLabStore((s) => s.hoveredPartId);
  const selected = useLabStore((s) => s.selectedPartId);

  useEffect(() => {
    const orbiting = { active: false, last: null as ScreenPoint | null };
    return commandBus.subscribe(({ command }) => {
      const store = useLabStore.getState();
      switch (command.type) {
        case "HOVER":
          store.setHovered(pickRef.current(command.screen));
          break;
        case "GRAB_PART": {
          const id = pickRef.current(command.screen);
          store.setSelected(id);
          // 빈 공간을 잡으면 모델 회전으로 처리
          orbiting.active = id === null;
          orbiting.last = command.screen;
          break;
        }
        case "MOVE_PART":
          if (orbiting.active && orbiting.last) {
            store.rotate(
              (command.screen.x - orbiting.last.x) * Math.PI,
              (command.screen.y - orbiting.last.y) * Math.PI,
            );
            orbiting.last = command.screen;
          }
          break;
        case "RELEASE_PART":
          orbiting.active = false;
          break;
        case "ROTATE_MODEL":
          store.rotate(command.dYaw, command.dPitch);
          break;
        case "CANCEL":
          store.setSelected(null);
          break;
        default:
          break;
      }
    });
  }, []);

  if (!model) return null;
  return (
    <group rotation={[pitch, yaw, 0]}>
      <group ref={group} position={MODEL_CENTER.clone().negate()}>
        {model.slots.map((slot) => {
          const part = model.parts.find((p) => p.part_id === slot.accepts_part_id);
          if (!part) return null;
          return (
            <group
              key={slot.slot_id}
              position={slot.position}
              rotation={[0, THREE.MathUtils.degToRad(slot.yaw_deg), 0]}
            >
              <PartVisual
                part={part}
                highlighted={hovered === part.part_id}
                selected={selected === part.part_id}
              />
            </group>
          );
        })}
      </group>
    </group>
  );
}

export function GearboxScene({ onCanvas }: { onCanvas?: (el: HTMLCanvasElement) => void }) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 2.6, 4.2], fov: 45 }}
      onCreated={({ gl }) => onCanvas?.(gl.domElement)}
    >
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
  );
}
