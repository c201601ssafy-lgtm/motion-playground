import { create } from "zustand";
import type { MechanismModel } from "../types/model";

const PITCH_LIMIT = 1.2;

export interface LabState {
  model: MechanismModel | null;
  loadError: string | null;
  yaw: number;
  pitch: number;
  hoveredPartId: string | null;
  selectedPartId: string | null;
  lastCommand: string | null;
  setModel: (model: MechanismModel) => void;
  setLoadError: (error: string) => void;
  rotate: (dYaw: number, dPitch: number) => void;
  setHovered: (id: string | null) => void;
  setSelected: (id: string | null) => void;
  setLastCommand: (label: string) => void;
}

export const useLabStore = create<LabState>((set) => ({
  model: null,
  loadError: null,
  yaw: -0.4,
  pitch: 0.35,
  hoveredPartId: null,
  selectedPartId: null,
  lastCommand: null,
  setModel: (model) => set({ model, loadError: null }),
  setLoadError: (loadError) => set({ loadError }),
  rotate: (dYaw, dPitch) =>
    set((s) => ({
      yaw: s.yaw + dYaw,
      pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, s.pitch + dPitch)),
    })),
  setHovered: (hoveredPartId) => set({ hoveredPartId }),
  setSelected: (selectedPartId) => set({ selectedPartId }),
  setLastCommand: (lastCommand) => set({ lastCommand }),
}));
