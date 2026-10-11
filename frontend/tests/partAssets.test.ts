import { describe, expect, it } from "vitest";
import { resolveAssetUrls } from "../src/three/partAssets";

describe("resolveAssetUrls (P5-9)", () => {
  it("상대 경로는 배포 경로 아래 모델 폴더로, 절대 경로·URL은 그대로", () => {
    const urls = resolveAssetUrls(
      { parts: { a: "parts/a.glb", b: "/cdn/b.glb", c: "https://x.test/c.GLB" } },
      "gearbox",
      "/holoforge-ai-lab/",
    );
    expect(urls).toEqual({
      a: "/holoforge-ai-lab/models/gearbox/parts/a.glb",
      b: "/cdn/b.glb",
      c: "https://x.test/c.GLB",
    });
  });

  it("glb가 아니거나 형식이 깨진 목록은 무시한다 (전부 절차적 형상)", () => {
    expect(resolveAssetUrls({ parts: { a: "a.obj", b: 3 } }, "gearbox")).toEqual({});
    expect(resolveAssetUrls(null, "gearbox")).toEqual({});
    expect(resolveAssetUrls({ parts: "x" }, "gearbox")).toEqual({});
  });
});
