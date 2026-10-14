import { useGLTF } from "@react-three/drei";
import { Component, type ReactNode, Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useLabStore } from "../store/labStore";
import type { Part, PartKind } from "../types/model";
import { gearOutline } from "./gearShape";

// 시각 메시만 담당. 충돌체(part.collider)와 분리되어 있다.
// assets.json에 GLB가 있으면 그것을 그리고(P5-9), 없거나 실패하면 절차적 형상을 그린다.

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
  armed?: boolean;
  selected?: boolean;
  opacity?: number;
}

interface Look {
  color: string;
  transparent: boolean;
  opacity: number;
  emissive: string;
  /** GLB는 색을 덮어쓰지 않으므로 강조(hover)도 발광색으로 보여준다 */
  glbEmissive: string;
}

function look(part: Part, highlighted: boolean, selected: boolean, opacity: number, armed: boolean): Look {
  const transparent = opacity < 1 || part.kind === "cover";
  return {
    color: selected ? "#3fb950" : armed ? "#d2a8ff" : highlighted ? "#f0f6fc" : KIND_COLOR[part.kind],
    transparent,
    opacity: part.kind === "cover" ? Math.min(opacity, 0.35) : opacity,
    emissive: selected ? "#1a7f37" : armed ? "#6e40aa" : "#000000",
    glbEmissive: selected ? "#1a7f37" : armed ? "#6e40aa" : highlighted ? "#30363d" : "#000000",
  };
}

function ProceduralPart({ part, l }: { part: Part; l: Look }) {
  const gearGeom = useGearGeometry(part);
  const g = part.geometry;
  return (
    <mesh castShadow receiveShadow userData={{ partId: part.part_id }} geometry={gearGeom ?? undefined}>
      {g.type === "box" && <boxGeometry args={g.size} />}
      {g.type === "cylinder" && <cylinderGeometry args={[g.radius, g.radius, g.length, 24]} />}
      <meshStandardMaterial
        color={l.color}
        metalness={0.4}
        roughness={0.45}
        transparent={l.transparent}
        opacity={l.opacity}
        depthWrite={!l.transparent}
        emissive={l.emissive}
      />
    </mesh>
  );
}

/** GLB 장면을 복제해 그린다. 각 메시에 partId를 달아 선택·드래그가 그대로 되게 하고, 강조는 발광색으로 표시한다. */
function GlbPart({ part, url, l }: { part: Part; url: string; l: Look }) {
  const { scene } = useGLTF(url);
  const root = useMemo(() => {
    const s = scene.clone(true);
    s.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.userData.partId = part.part_id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // 복제본마다 재질을 따로 둬야 한 부품의 강조가 다른 부품에 번지지 않는다
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
    });
    return s;
  }, [scene, part.part_id]);

  useEffect(() => {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.emissive) std.emissive.set(l.glbEmissive);
        std.transparent = l.transparent;
        std.opacity = l.opacity;
        std.depthWrite = !l.transparent;
      }
    });
  }, [root, l.glbEmissive, l.transparent, l.opacity]);

  return <primitive object={root} />;
}

/** GLB를 못 불러오면 절차적 형상으로 돌아간다 (경고 한 번) */
class AssetBoundary extends Component<{ fallback: ReactNode; url: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    console.warn(`[PartVisual] GLB 로드 실패, 절차적 형상 사용: ${this.props.url}`, err);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function PartVisual({ part, highlighted = false, armed = false, selected = false, opacity = 1 }: Props) {
  const url = useLabStore((s) => s.partAssets[part.part_id]);
  const l = look(part, highlighted, selected, opacity, armed);
  const procedural = <ProceduralPart part={part} l={l} />;
  if (!url) return procedural;
  return (
    <AssetBoundary key={url} url={url} fallback={procedural}>
      <Suspense fallback={procedural}>
        <GlbPart part={part} url={url} l={l} />
      </Suspense>
    </AssetBoundary>
  );
}
