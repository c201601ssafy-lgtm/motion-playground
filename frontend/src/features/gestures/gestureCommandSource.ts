// GestureEvent → Command (D-004). 비전 코드는 화면 좌표까지만 만든다. 대상 부품은 3D 계층이 정한다.

import type { CommandBusLike, CommandSource, ScreenPoint } from "../commands/types";
import type { GestureEvent, HandId } from "./types";

export const GESTURE_MAPPING = {
  /** 카메라 중앙 영역만으로 화면 전체를 가리킬 수 있도록 확대 */
  screenGain: 1.5,
  /** 손 이동량(정규화) → 회전(rad). 화면 폭의 1/3을 움직이면 약 180° */
  rotateSensitivity: Math.PI * 3,
  /** 집은 채 손목을 이만큼(°) 돌릴 때마다 부품을 한 칸 돌린다. 손목 90°로 부품 180° */
  rollStepDeg: 7.5,
  /** 부품 회전 한 칸(°). 휠·[ ] 키와 같다 */
  partStepDeg: 15,
};

/** 각도 차이를 -180~180으로 */
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

type Subscribe = (listener: (e: GestureEvent) => void) => () => void;

/** 정규화 이미지 좌표(거울 반전 전) → 캔버스 화면 좌표(0..1). 셀피 화면이므로 x를 뒤집는다. */
export function toScreen(p: { x: number; y: number }, gain = GESTURE_MAPPING.screenGain): ScreenPoint {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(0.5 + (1 - p.x - 0.5) * gain), y: clamp(0.5 + (p.y - 0.5) * gain) };
}

export interface HandCursor {
  screen: ScreenPoint;
  gesture: GestureEvent["type"];
  selectionLocked?: boolean;
}

export class GestureCommandSource implements CommandSource {
  readonly name = "gesture";
  private unsub: (() => void) | null = null;
  /** 집기 종료 직후 같은 프레임에 주먹이 시작되면 놓기 대신 취소하기 위해 잠깐 보류 */
  private pendingRelease: ScreenPoint | null = null;
  /** 집기 중 손 기울기 추적: 마지막 각도와 아직 한 칸이 안 된 누적량 */
  private roll: { last: number; acc: number } | null = null;
  private target: { screen: ScreenPoint; at: number } | null = null;
  private pinchOffset: ScreenPoint = { x: 0, y: 0 };
  private selectionLocked = false;

  constructor(
    private readonly subscribe: Subscribe,
    private readonly onCursor: (cursor: HandCursor | null) => void = () => {},
    private readonly hand?: HandId,
  ) {}

  start(sink: CommandBusLike): void {
    const bus: CommandBusLike = {
      publish: (command, source) => sink.publish(this.hand ? { ...command, hand: this.hand } : command, source),
    };
    const setLock = (locked: boolean) => {
      if (this.selectionLocked === locked) return;
      this.selectionLocked = locked;
      bus.publish({ type: "LOCK_SELECTION", locked }, this.name);
    };
    this.unsub = this.subscribe((e) => {
      if (this.hand && e.hand !== this.hand) return;
      const rawScreen = toScreen(e.position);
      const useHovered = e.type === "PINCH" && e.phase === "start" && !!this.target && e.timestamp - this.target.at <= 350;
      if (e.type === "PINCH" && e.phase === "start") {
        const target = this.target && e.timestamp - this.target.at <= 350 ? this.target.screen : rawScreen;
        this.pinchOffset = { x: target.x - rawScreen.x, y: target.y - rawScreen.y };
        this.target = null;
      }
      const screen = e.type === "PINCH"
        ? { x: Math.max(0, Math.min(1, rawScreen.x + this.pinchOffset.x)), y: Math.max(0, Math.min(1, rawScreen.y + this.pinchOffset.y)) }
        : e.type === "POINT" && e.selectionLocked && this.target ? this.target.screen : rawScreen;
      setLock(e.type === "POINT" && e.phase !== "end" && !!e.selectionLocked);
      this.onCursor(e.phase === "end" ? null : { screen, gesture: e.type, ...(this.selectionLocked ? { selectionLocked: true } : {}) });
      switch (e.type) {
        case "POINT":
          if (e.phase !== "end") {
            this.target = { screen, at: e.timestamp };
            if (!this.selectionLocked) bus.publish({ type: "HOVER", screen }, this.name);
          }
          break;
        case "PINCH":
          if (e.phase === "start") {
            this.roll = e.roll === undefined ? null : { last: e.roll, acc: 0 };
            bus.publish({ type: "GRAB_PART", screen, ...(useHovered ? { useHovered: true } : {}) }, this.name);
          } else if (e.phase === "hold") {
            bus.publish({ type: "MOVE_PART", screen }, this.name);
            this.rotateByRoll(bus, e.roll);
          } else {
            this.roll = null;
            if (e.trackingLost) {
              this.pendingRelease = null;
              this.target = null;
              bus.publish({ type: "CANCEL" }, this.name);
              break;
            }
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
          this.target = null;
          if (e.phase === "hold" && (e.delta.x !== 0 || e.delta.y !== 0)) {
            const k = GESTURE_MAPPING.rotateSensitivity;
            // 거울 화면: 손을 오른쪽으로 움직이면 이미지 x는 감소 → 모델은 오른쪽(+yaw)으로
            bus.publish({ type: "ROTATE_MODEL", dYaw: -e.delta.x * k, dPitch: e.delta.y * k }, this.name);
          }
          if (e.phase !== "end") bus.publish({ type: "HOVER", screen }, this.name);
          break;
        case "FIST":
          this.target = null;
          if (e.phase === "start") {
            this.pendingRelease = null;
            bus.publish({ type: "CANCEL" }, this.name);
          }
          break;
      }
    });
  }

  /**
   * 손목을 돌리면 부품을 돌린다. 이미지에서 + 방향(오른쪽)으로 기울면 거울 화면에서는 반시계로 보이므로
   * 부품도 위에서 볼 때 반시계(+yaw)로 돌린다. 한 칸 단위로 끊어 손 떨림에 흔들리지 않게 한다.
   */
  private rotateByRoll(bus: CommandBusLike, roll: number | undefined): void {
    if (!this.roll || roll === undefined) return;
    const { rollStepDeg, partStepDeg } = GESTURE_MAPPING;
    this.roll.acc += wrapDeg(roll - this.roll.last);
    this.roll.last = roll;
    while (Math.abs(this.roll.acc) >= rollStepDeg) {
      const dir = Math.sign(this.roll.acc);
      this.roll.acc -= dir * rollStepDeg;
      bus.publish({ type: "ROTATE_PART", dYawDeg: dir * partStepDeg }, this.name);
    }
  }

  stop(): void {
    this.selectionLocked = false;
    this.target = null;
    this.pendingRelease = null;
    this.roll = null;
    this.pinchOffset = { x: 0, y: 0 };
    this.unsub?.();
    this.unsub = null;
    this.onCursor(null);
  }
}
