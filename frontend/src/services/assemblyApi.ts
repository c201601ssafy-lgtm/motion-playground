import type { AssemblyResult, AssemblySnapshot, MechanismState, SessionOut } from "../types/assembly";
import type { Vec3 } from "../types/model";
import { getJson, postJson } from "./api";

export const createSession = (modelId = "gearbox") => postJson<SessionOut>("/sessions", { model_id: modelId });
export const getSession = (id: string) => getJson<SessionOut>(`/sessions/${id}`);

export const attemptPlace = (id: string, body: { part_id: string; position: Vec3; axis?: Vec3; yaw_deg: number }) =>
  postJson<{ result: AssemblyResult; snapshot: AssemblySnapshot }>(`/sessions/${id}/attempt`, body);

export const resetStep = (id: string) =>
  postJson<{ removed: string[]; snapshot: AssemblySnapshot }>(`/sessions/${id}/reset-step`);

export const assembleAll = (id: string) => postJson<AssemblySnapshot>(`/sessions/${id}/assemble-all`);

export const getMechanism = (id: string, inputRpm: number) =>
  getJson<MechanismState>(`/sessions/${id}/mechanism?input_rpm=${encodeURIComponent(inputRpm)}`);
