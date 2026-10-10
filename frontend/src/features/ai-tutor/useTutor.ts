import { create } from "zustand";
import { postJson } from "../../services/api";
import * as api from "../../services/assemblyApi";
import { useAssemblyStore } from "../../store/assemblyStore";
import { useLabStore } from "../../store/labStore";
import { useOperateStore } from "../../store/operateStore";
import type { TutorAction, TutorResponse } from "../../types/tutor";
import { commandBus } from "../commands/commandBus";

export interface TutorEntry {
  id: number;
  question: string;
  selectedPart: string | null;
  response: TutorResponse | null;
  error: string | null;
}

interface TutorState {
  entries: TutorEntry[];
  busy: boolean;
  set: (patch: Partial<Omit<TutorState, "set">>) => void;
}

export const useTutorStore = create<TutorState>((set) => ({
  entries: [],
  busy: false,
  set: (patch) => set(patch),
}));

let nextId = 1;

async function ensureSession(): Promise<string> {
  const asm = useAssemblyStore.getState();
  if (asm.sessionId) return asm.sessionId;
  const model = useLabStore.getState().model;
  const s = await api.createSession(model?.meta.model_id ?? "gearbox");
  useAssemblyStore.getState().set({ sessionId: s.session_id, snapshot: s.snapshot });
  return s.session_id;
}

async function applyActions(actions: TutorAction[], sessionId: string) {
  for (const a of actions) {
    if (a.type === "run_simulation") {
      useOperateStore.getState().set({ inputRpm: a.input_rpm });
      commandBus.publish({ type: "SET_MODE", mode: "operate" }, "tutor");
    } else if (a.type === "assembly_changed") {
      const s = await api.getSession(sessionId);
      useAssemblyStore.getState().set({ snapshot: s.snapshot });
    }
  }
}

export async function askTutor(question: string) {
  const q = question.trim();
  if (!q || useTutorStore.getState().busy) return;
  const selectedPart = useLabStore.getState().selectedPartId;
  const id = nextId++;
  const store = useTutorStore.getState();
  store.set({ busy: true, entries: [...store.entries, { id, question: q, selectedPart, response: null, error: null }] });
  const update = (patch: Partial<TutorEntry>) =>
    useTutorStore.getState().set({
      entries: useTutorStore.getState().entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  try {
    const sid = await ensureSession();
    const res = await postJson<TutorResponse>(`/sessions/${sid}/tutor`, {
      question: q,
      selected_part: selectedPart,
    });
    update({ response: res });
    await applyActions(res.actions, sid);
  } catch (err) {
    update({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    useTutorStore.getState().set({ busy: false });
  }
}

/** 조립 오류 직후 원클릭 질문: 튜터 모드로 가서 바로 묻는다. */
export function askWhyWrong(question: string) {
  commandBus.publish({ type: "SET_MODE", mode: "tutor" }, "ui");
  void askTutor(question);
}
