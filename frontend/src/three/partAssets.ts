// 부품 GLB 에셋 목록 (P5-9). public/models/<model_id>/assets.json 에 { "parts": { "<part_id>": "parts/x.glb" } }.
// 목록에 없거나 불러오지 못한 부품은 절차적 형상(PartVisual)을 그대로 쓴다.
// GLB 좌표계: 원점 = 부품 원점(슬롯 위치), +Y = 회전축, 단위 = 모델 단위. docs/architecture.md 참고.

export interface AssetManifest {
  parts: Record<string, string>;
}

/** 목록의 상대 경로를 배포 경로(BASE_URL) 기준 URL로 바꾼다. 절대 URL은 그대로 둔다. */
export function resolveAssetUrls(manifest: unknown, modelId: string, base = "/"): Record<string, string> {
  const parts = (manifest as AssetManifest | null)?.parts;
  if (!parts || typeof parts !== "object") return {};
  const out: Record<string, string> = {};
  for (const [partId, path] of Object.entries(parts)) {
    if (typeof path !== "string" || !path.toLowerCase().endsWith(".glb")) continue;
    out[partId] = /^(https?:)?\/\//.test(path) || path.startsWith("/") ? path : `${base}models/${modelId}/${path}`;
  }
  return out;
}

/** 목록이 없거나 깨졌으면 빈 목록 (전부 절차적 형상) */
export async function loadPartAssets(modelId: string): Promise<Record<string, string>> {
  const base = import.meta.env.BASE_URL;
  try {
    const res = await fetch(`${base}models/${encodeURIComponent(modelId)}/assets.json`);
    if (!res.ok) return {};
    return resolveAssetUrls(await res.json(), modelId, base);
  } catch {
    return {};
  }
}
