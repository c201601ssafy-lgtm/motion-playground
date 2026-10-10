import { create } from "zustand";
import type { MechanismState } from "../types/assembly";

export interface OperateState {
  inputRpm: number;
  mechanism: MechanismState | null;
  loading: boolean;
  error: string | null;
  set: (patch: Partial<Omit<OperateState, "set">>) => void;
}

export const useOperateStore = create<OperateState>((set) => ({
  inputRpm: 30,
  mechanism: null,
  loading: false,
  error: null,
  set: (patch) => set(patch),
}));
