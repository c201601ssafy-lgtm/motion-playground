// 튜터 화면 보조 로직 (순수 함수).

import type { TutorResponse, UsedTool } from "../../types/tutor";
import { ERROR_TITLE } from "../assembly/assemblyLogic";
import type { ErrorType } from "../../types/assembly";

export const EXAMPLE_QUESTIONS = [
  "이 작은 기어는 어떤 역할을 해?",
  "왜 이쪽으로 돌면 반대쪽 기어가 반대로 돌아?",
  "왜 지금 작동하지 않아?",
  "기어비를 높이면 어떻게 돼?",
  "내가 어떤 부품을 잘못 끼웠어?",
];

export const WHY_WRONG_QUESTION = "내가 어떤 부품을 잘못 끼웠어? 어떻게 고치면 돼?";

export const TOOL_LABEL: Record<string, string> = {
  get_part_info: "부품 정보 조회",
  get_assembly_state: "조립 상태 조회",
  get_assembly_error: "조립 오류 조회",
  get_mechanism_state: "기구 상태 계산",
  run_visual_simulation: "작동 시각화 실행",
  reset_assembly_step: "현재 단계 되돌리기",
};

/** 사용한 도구와 결과로 관련 개념 태그를 만든다. */
export function relatedConcepts(used: UsedTool[]): string[] {
  const tags = new Set<string>();
  for (const u of used) {
    const r = u.result as Record<string, unknown>;
    switch (u.name) {
      case "get_mechanism_state":
      case "run_visual_simulation":
        tags.add("기어비");
        tags.add("회전 방향");
        if (r.operable) tags.add("감속과 토크");
        break;
      case "get_part_info":
        if (r.kind === "gear") tags.add("평기어");
        if (r.kind === "shaft") tags.add("축과 지지");
        if (r.part_id === "gear-idler-24t") tags.add("아이들러");
        if (Array.isArray(r.meshes_with) && r.meshes_with.length) tags.add("맞물림");
        break;
      case "get_assembly_error":
        if (r.has_error && typeof r.error_type === "string") {
          tags.add(ERROR_TITLE[r.error_type as ErrorType] ?? r.error_type);
        }
        tags.add("조립 순서");
        break;
      case "get_assembly_state":
        tags.add("조립 순서");
        break;
    }
  }
  return [...tags];
}

export interface WarningBadge {
  level: "warn" | "info";
  text: string;
}

export function warningBadges(r: Pick<TutorResponse, "warnings" | "degraded">): WarningBadge[] {
  const out: WarningBadge[] = [];
  for (const w of r.warnings) {
    if (w.startsWith("UNGROUNDED_NUMBER:")) {
      out.push({ level: "warn", text: `도구 결과에 없는 숫자: ${w.split(":")[1]}` });
    } else if (w === "NO_TOOLS_USED") out.push({ level: "warn", text: "도구 없이 답함 (사실 확인 안 됨)" });
    else if (w === "TOOL_ERROR") out.push({ level: "info", text: "도구 호출 오류 후 재시도" });
    else out.push({ level: "info", text: w });
  }
  if (r.degraded) out.push({ level: "info", text: "LLM 연결 실패 → 규칙 기반 답변" });
  return out;
}
