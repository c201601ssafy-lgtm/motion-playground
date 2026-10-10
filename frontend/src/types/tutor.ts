// 백엔드 app/ai/tutor.py TutorResponse 와 같은 구조.

export interface UsedTool {
  name: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
}

export type TutorAction = { type: "run_simulation"; input_rpm: number } | { type: "assembly_changed" };

export interface TutorResponse {
  answer: string;
  used_tools: UsedTool[];
  cited_values: number[];
  warnings: string[];
  actions: TutorAction[];
  degraded: boolean;
  provider: string;
  rounds: number;
  latency_ms: number;
}
