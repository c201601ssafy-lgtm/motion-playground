import { describe, expect, it } from "vitest";
import { classifyCameraError } from "../src/features/camera/camera";

describe("classifyCameraError", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "no-device"],
    ["OverconstrainedError", "no-device"],
    ["NotReadableError", "in-use"],
    ["InsecureContextError", "insecure"],
    ["UnsupportedError", "unsupported"],
    ["WeirdError", "unknown"],
  ])("%s → %s", (name, kind) => {
    const e = classifyCameraError(Object.assign(new Error("x"), { name }));
    expect(e.kind).toBe(kind);
    expect(e.message.length).toBeGreaterThan(0);
  });

  it("handles non-error values", () => {
    expect(classifyCameraError(null).kind).toBe("unknown");
  });
});
