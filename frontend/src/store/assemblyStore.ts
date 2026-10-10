import { create } from "zustand";
import type { Toast } from "../features/assembly/assemblyLogic";
import type { AssemblyResult, AssemblySnapshot } from "../types/assembly";

export interface AssemblyState {
  sessionId: string | null;
  snapshot: AssemblySnapshot | null;
  lastResult: AssemblyResult | null;
  toast: Toast | null;
  busy: boolean;
  error: string | null;
  attempts: number;
  errors: number;
  startedAt: number | null;
  completedAt: number | null;
  set: (patch: Partial<Omit<AssemblyState, "set">>) => void;
}

export const useAssemblyStore = create<AssemblyState>((set) => ({
  sessionId: null,
  snapshot: null,
  lastResult: null,
  toast: null,
  busy: false,
  error: null,
  attempts: 0,
  errors: 0,
  startedAt: null,
  completedAt: null,
  set: (patch) => set(patch),
}));
