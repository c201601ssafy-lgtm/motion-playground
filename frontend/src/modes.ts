// 화면 모드 (spec §15). 해시 라우트(#/assemble 등)가 단일 진실 원천이다.

export type Mode = "lab" | "disassemble" | "assemble" | "operate" | "tutor" | "results" | "record" | "racing" | "motionlab" | "crumple";

export interface ModeInfo {
  id: Mode;
  label: string;
  /** 키보드 단축키 */
  key: string;
}

export const MODES: ModeInfo[] = [
  { id: "lab", label: "연구실", key: "1" },
  { id: "disassemble", label: "분해", key: "2" },
  { id: "assemble", label: "조립", key: "3" },
  { id: "operate", label: "작동", key: "4" },
  { id: "tutor", label: "AI 튜터", key: "5" },
  { id: "results", label: "실험 결과", key: "6" },
  { id: "record", label: "데이터 녹화", key: "7" },
  { id: "racing", label: "핸들 테스트", key: "8" },
  { id: "motionlab", label: "게임 모션", key: "9" },
  { id: "crumple", label: "창 구기기", key: "0" },
];

const IDS = new Set<string>(MODES.map((m) => m.id));

export function parseMode(hash: string): Mode {
  const id = hash.replace(/^#\/?/, "");
  return IDS.has(id) ? (id as Mode) : "lab";
}

export function modeHash(mode: Mode): string {
  return `#/${mode}`;
}
