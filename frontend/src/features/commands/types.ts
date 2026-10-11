// D-004: 입력 장치와 3D 조작 사이의 명령 계층.
import type { Mode } from "../../modes";

// 화면 좌표는 캔버스 기준 0..1 정규화 (x: 왼→오, y: 위→아래).

export interface ScreenPoint {
  x: number;
  y: number;
}

export type Command =
  | { type: "HOVER"; screen: ScreenPoint }
  | { type: "GRAB_PART"; screen: ScreenPoint }
  | { type: "MOVE_PART"; screen: ScreenPoint }
  | { type: "RELEASE_PART"; screen: ScreenPoint }
  | { type: "ROTATE_MODEL"; dYaw: number; dPitch: number }
  | { type: "CANCEL" }
  | { type: "EXPLODE"; on?: boolean }
  | { type: "ASSEMBLE_ALL" }
  | { type: "RESET_STEP" }
  | { type: "ROTATE_PART"; dYawDeg: number }
  | { type: "SET_MODE"; mode: Mode };

export type CommandType = Command["type"];

export interface CommandSource {
  readonly name: string;
  start(bus: CommandBusLike): void;
  stop(): void;
}

export interface CommandBusLike {
  publish(command: Command, source: string): void;
}
