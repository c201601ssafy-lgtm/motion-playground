import { describe, expect, it } from "vitest";
import { EXAMPLE_QUESTIONS, relatedConcepts, warningBadges } from "../src/features/ai-tutor/tutorLogic";

describe("tutor logic", () => {
  it("offers the five spec example questions", () => {
    expect(EXAMPLE_QUESTIONS).toHaveLength(5);
  });

  it("derives concept tags from tool usage", () => {
    const tags = relatedConcepts([
      { name: "get_mechanism_state", arguments: {}, result: { operable: true } },
      { name: "get_part_info", arguments: {}, result: { kind: "gear", part_id: "gear-idler-24t", meshes_with: ["a"] } },
      { name: "get_assembly_error", arguments: {}, result: { has_error: true, error_type: "WRONG_ORIENTATION" } },
    ]);
    expect(tags).toEqual(expect.arrayContaining(["기어비", "회전 방향", "감속과 토크", "아이들러", "맞물림", "방향 틀림"]));
  });

  it("turns warnings into readable badges", () => {
    const b = warningBadges({ warnings: ["UNGROUNDED_NUMBER:42,7", "NO_TOOLS_USED"], degraded: true });
    expect(b.map((x) => x.text)).toEqual([
      "도구 결과에 없는 숫자: 42,7",
      "도구 없이 답함 (사실 확인 안 됨)",
      "LLM 연결 실패 → 규칙 기반 답변",
    ]);
    expect(b[0]!.level).toBe("warn");
  });
});
