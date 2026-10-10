// GestureEvent → Command (D-004). 비전 코드는 화면 좌표까지만 만든다. 대상 부품은 3D 계층이 정한다.

import type { CommandBusLike, CommandSource, ScreenPoint } from "../commands/types";
import type { GestureEvent } from "./types";

export const GESTURE_MAPPING = {
  /** 카메라 중앙 영역만으로 화면 전체를 가리킬 수 있도록 확대 */
  screenGain: 1.5,
  /** 손 이동량(정규화) → 회전(rad). 화면 폭의 1/3을 움직이면 약 180° */
  rotateSensitivity: Math.PI * 3,
};

type Subscribe = (listener: (e: GestureEvent) => void) => () => void;

/** 정규화 이미지 좌표(거울 반전 전) → 캔버스 화면 좌표(0..1). 셀피 화면이므로 x를 뒤집는다. */
export function toScreen(p: { x: number; y: number }, gain = GESTURE_MAPPING.screenGain): ScreenPoint {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(0.5 + (1 - p.x - 0.5) * gain), y: clamp(0.5 + (p.y - 0.5) * gain) };
}

export interface HandCursor {
  screen: ScreenPoint;
  gesture: GestureEvent["type"];
}

export class GestureCommandSource implements CommandSource {
  readonly name = "gesture";
  private unsub: (() => void) | null = null;
  /** 집기 종료 직후 같은 프레임에 주먹이 시작되면 놓기 대신 취소하기 위해 잠깐 보류 */
  private pendingRelease: ScreenPoint | null = null;

  constructor(
    private readonly subscribe: Subscribe,
    private readonly onCursor: (cursor: HandCursor | null) => void = () => {},
  ) {}

  start(bus: CommandBusLike): void {
    this.unsub = this.subscribe((e) => {
      const screen = toScreen(e.position);
      this.onCursor(e.phase === "end" ? null : { screen, gesture: e.type });
      switch (e.type) {
        case "PINCH":
          if (e.phase === "start") bus.publish({ type: "GRAB_PART", screen }, this.name);
          else if (e.phase === "hold") bus.publish({ type: "MOVE_PART", screen }, this.name);
          else {
            // 상태 머신은 전환 시 end와 start를 같은 update에서 연달아 낸다.
            // 바로 뒤에 FIST:start가 오면 취소로 바꾸고, 아니면 다음 마이크로태스크에 놓는다.
            this.pendingRelease = screen;
            queueMicrotask(() => {
              if (!this.pendingRelease) return;
              bus.publish({ type: "RELEASE_PART", screen: this.pendingRelease }, this.name);
              this.pendingRelease = null;
            });
          }
          break;
        case "OPEN_PALM":
          if (e.phase === "hold" && (e.delta.x !== 0 || e.delta.y !== 0)) {
            const k = GESTURE_MAPPING.rotateSensitivity;
            // 거울 화면: 손을 오른쪽으로 움직이면 이미지 x는 감소 → 모델은 오른쪽(+yaw)으로
            bus.publish({ type: "ROTATE_MODEL", dYaw: -e.delta.x * k, dPitch: e.delta.y * k }, this.name);
          }
          if (e.phase !== "end") bus.publish({ type: "HOVER", screen }, this.name);
          break;
        case "FIST":
          if (e.phase === "start") {
            this.pendingRelease = null;
            bus.publish({ type: "CANCEL" }, this.name);
          }
          break;
      }
    });
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    this.onCursor(null);
  }
}
