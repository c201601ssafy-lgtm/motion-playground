import { create } from "zustand";
import type { HandCursor } from "../features/gestures/gestureCommandSource";
import type { Mode } from "../modes";
import type { MechanismModel, Vec3 } from "../types/model";

const PITCH_LIMIT = 1.2;

export interface PartPose {
  /** 모델 좌표계 위치 */
  position: Vec3;
  /** 회전축(y) 기준 회전 (°) */
  yaw: number;
}

export interface DropEvent {
  partId: string;
  pose: PartPose;
}

export interface LabState {
  mode: Mode;
  setMode: (mode: Mode) => void;
  model: MechanismModel | null;
  loadError: string | null;
  /** 백엔드 없이 정적 모델만 불러온 상태 (조립 판정 불가) */
  offline: boolean;
  /** 분해도 표시 여부 (애니메이션 목표값) */
  exploded: boolean;
  /** 포커스된 부품 외에는 흐리게 */
  focusPartId: string | null;
  setExploded: (v: boolean) => void;
  /** 잡을 수 없는 부품 (조립 완료된 부품 등) */
  lockedParts: string[];
  setLockedParts: (ids: string[]) => void;
  /** 드래그 중 가장 가까운 결합 지점 (표시용) */
  guide: { slotId: string; distance: number; inRange: boolean } | null;
  setGuide: (g: LabState["guide"]) => void;
  /** 작동 모드 기어 각속도 (rad/s, 회전축 y 기준) */
  spins: Record<string, number>;
  setSpins: (spins: Record<string, number>) => void;
  setFocus: (id: string | null) => void;
  yaw: number;
  pitch: number;
  hoveredPartId: string | null;
  selectedPartId: string | null;
  draggingPartId: string | null;
  /** 기본 배치(슬롯 위치)와 다른 부품 자세. 없으면 슬롯 위치에 그린다. */
  poses: Record<string, PartPose>;
  /** 화면에 보이지 않는 부품 (조립 모드에서 아직 꺼내지 않은 부품 등) */
  hiddenParts: string[];
  cursor: HandCursor | null;
  lastCommand: string | null;
  /** 부품을 놓았을 때 호출 (조립 판정 등). 없으면 놓은 자리에 그대로 둔다. */
  onDrop: ((e: DropEvent) => void) | null;
  setModel: (model: MechanismModel, offline?: boolean) => void;
  setLoadError: (error: string) => void;
  rotate: (dYaw: number, dPitch: number) => void;
  setView: (yaw: number, pitch: number) => void;
  setHovered: (id: string | null) => void;
  setSelected: (id: string | null) => void;
  setDragging: (id: string | null) => void;
  setPose: (id: string, pose: PartPose) => void;
  clearPose: (id: string) => void;
  setPoses: (poses: Record<string, PartPose>) => void;
  setHiddenParts: (ids: string[]) => void;
  setCursor: (cursor: HandCursor | null) => void;
  setLastCommand: (label: string) => void;
  setOnDrop: (fn: ((e: DropEvent) => void) | null) => void;
}

export const useLabStore = create<LabState>((set) => ({
  mode: "lab",
  setMode: (mode) => set({ mode }),
  model: null,
  loadError: null,
  offline: false,
  exploded: false,
  focusPartId: null,
  setExploded: (exploded) => set({ exploded }),
  lockedParts: [],
  setLockedParts: (lockedParts) => set({ lockedParts }),
  guide: null,
  setGuide: (guide) => set({ guide }),
  spins: {},
  setSpins: (spins) => set({ spins }),
  setFocus: (focusPartId) => set({ focusPartId }),
  yaw: -0.4,
  pitch: 0.35,
  hoveredPartId: null,
  selectedPartId: null,
  draggingPartId: null,
  poses: {},
  hiddenParts: [],
  cursor: null,
  lastCommand: null,
  onDrop: null,
  setModel: (model, offline = false) => set({ model, offline, loadError: null }),
  setLoadError: (loadError) => set({ loadError }),
  rotate: (dYaw, dPitch) =>
    set((s) => ({
      yaw: s.yaw + dYaw,
      pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, s.pitch + dPitch)),
    })),
  setView: (yaw, pitch) => set({ yaw, pitch }),
  setHovered: (hoveredPartId) => set({ hoveredPartId }),
  setSelected: (selectedPartId) => set({ selectedPartId }),
  setDragging: (draggingPartId) => set({ draggingPartId }),
  setPose: (id, pose) => set((s) => ({ poses: { ...s.poses, [id]: pose } })),
  clearPose: (id) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.poses;
      return { poses: rest };
    }),
  setPoses: (poses) => set({ poses }),
  setHiddenParts: (hiddenParts) => set({ hiddenParts }),
  setCursor: (cursor) => set({ cursor }),
  setLastCommand: (lastCommand) => set({ lastCommand }),
  setOnDrop: (onDrop) => set({ onDrop }),
}));
