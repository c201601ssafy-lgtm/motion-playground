import { useMemo } from "react";
import * as THREE from "three";
import type { Part, PartKind } from "../types/model";
import { gearOutline } from "./gearShape";

// 시각 메시만 담당. 충돌체(part.collider)와 분리되어 있고, 나중에 GLB로 교체할 수 있다.

const KIND_COLOR: Record<PartKind, string> = {
  base: "#5b6b7f",
  shaft: "#c9d1d9",
  gear: "#d29922",
  cover: "#58a6ff",
};

function useGearGeometry(part: Part): THREE.BufferGeometry | null {
  return useMemo(() => {
    const g = part.geometry;
    if (g.type !== "gear") return null;
    const shape = new THREE.Shape(gearOutline(g.teeth, g.module).map((p) => new THREE.Vector2(p.x, p.y)));
    const hole = new THREE.Path();
    hole.absarc(0, 0, g.bore_radius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geom = new THREE.ExtrudeGeometry(shape, { depth: g.thickness, bevelEnabled: false });
    geom.translate(0, 0, -g.thickness / 2);
    geom.rotateX(-Math.PI / 2); // 압출 방향(z) → 회전축(y)
    return geom;
  }, [part]);
}

interface Props {
  part: Part;
  highlighted?: boolean;
  selected?: boolean;
  opacity?: number;
}

export function PartVisual({ part, highlighted = false, selected = false, opacity = 1 }: Props) {
  const gearGeom = useGearGeometry(part);
  const g = part.geometry;
  const color = selected ? "#3fb950" : highlighted ? "#f0f6fc" : KIND_COLOR[part.kind];
  const transparent = opacity < 1 || part.kind === "cover";
  const finalOpacity = part.kind === "cover" ? Math.min(opacity, 0.35) : opacity;

  return (
    <mesh castShadow receiveShadow userData={{ partId: part.part_id }} geometry={gearGeom ?? undefined}>
      {g.type === "box" && <boxGeometry args={g.size} />}
      {g.type === "cylinder" && <cylinderGeometry args={[g.radius, g.radius, g.length, 24]} />}
      <meshStandardMaterial
        color={color}
        metalness={0.4}
        roughness={0.45}
        transparent={transparent}
        opacity={finalOpacity}
        depthWrite={!transparent}
        emissive={selected ? "#1a7f37" : "#000000"}
      />
    </mesh>
  );
}
