import { Html } from "@react-three/drei";
import { useMemo } from "react";
import { useLabStore } from "../../store/labStore";
import { useOperateStore } from "../../store/operateStore";
import { contactPoints, directionLabel } from "./mechanismView";

/** 작동 모드 3D 오버레이: 기어 라벨, 맞물림 지점. (모델 좌표계 그룹 안에 넣는다) */
export function MechanismOverlay() {
  const model = useLabStore((s) => s.model);
  const mode = useLabStore((s) => s.mode);
  const mechanism = useOperateStore((s) => s.mechanism);
  const contacts = useMemo(() => (model ? contactPoints(model) : []), [model]);
  if (!model || mode !== "operate" || !mechanism?.operable) return null;

  return (
    <group>
      {contacts.map((c) => (
        <mesh key={c.key} position={c.position}>
          <sphereGeometry args={[0.05, 16, 16]} />
          <meshBasicMaterial color="#ff9f1a" />
        </mesh>
      ))}
      {mechanism.gears.map((g) => {
        const slot = model.slots.find((s) => s.accepts_part_id === g.part_id);
        if (!slot) return null;
        return (
          <Html
            key={g.part_id}
            position={[slot.position[0], slot.position[1] + 0.25, slot.position[2]]}
            center
            style={{ pointerEvents: "none" }}
          >
            <div
              data-testid={`gear-label-${g.part_id}`}
              style={{
                whiteSpace: "nowrap",
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                background: "#0d1117cc",
                border: `1px solid ${g.direction > 0 ? "#58a6ff" : "#f778ba"}`,
                color: "#e6edf3",
              }}
            >
              {g.teeth}T · {directionLabel(g)} · {Math.abs(g.rpm).toFixed(0)}rpm
            </div>
          </Html>
        );
      })}
    </group>
  );
}
