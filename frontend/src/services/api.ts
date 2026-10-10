import type { MechanismModel } from "../types/model";

export interface Health {
  status: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
    });
  } catch (err) {
    throw new ApiError(0, "백엔드에 연결할 수 없습니다", err);
  }
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = undefined;
    }
    throw new ApiError(res.status, `${res.status} ${res.statusText}`, detail);
  }
  return (await res.json()) as T;
}

export const getJson = <T>(path: string) => request<T>(path);
export const postJson = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const getHealth = () => getJson<Health>("/health");

/** 백엔드가 없으면(정적 배포) 빌드에 포함된 모델 JSON으로 대신한다. */
export async function getModel(modelId: string): Promise<{ model: MechanismModel; offline: boolean }> {
  try {
    return { model: await getJson<MechanismModel>(`/models/${encodeURIComponent(modelId)}`), offline: false };
  } catch (err) {
    const res = await fetch(`${import.meta.env.BASE_URL}models/${encodeURIComponent(modelId)}.json`);
    if (!res.ok) throw err;
    return { model: (await res.json()) as MechanismModel, offline: true };
  }
}
