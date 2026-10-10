import type { CommandBusLike, CommandSource, ScreenPoint } from "./types";

/** 마우스 → Command. 왼쪽 드래그 = 잡기/이동/놓기, 잡은 채 휠 = 부품 회전, 오른쪽 드래그 = 모델 회전. */

export interface PointerTarget extends EventTarget {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

interface PointerLike {
  clientX: number;
  clientY: number;
  button: number;
  pointerId?: number;
  preventDefault?: () => void;
}

export const ROTATE_SENSITIVITY = Math.PI; // 화면 폭만큼 드래그 = 180°

export class MouseCommandSource implements CommandSource {
  readonly name = "mouse";
  private bus: CommandBusLike | null = null;
  private dragButton: number | null = null;
  private last: ScreenPoint | null = null;

  constructor(private readonly target: PointerTarget) {}

  private toScreen(e: PointerLike): ScreenPoint {
    const r = this.target.getBoundingClientRect();
    return {
      x: r.width ? (e.clientX - r.left) / r.width : 0,
      y: r.height ? (e.clientY - r.top) / r.height : 0,
    };
  }

  private onDown = (ev: Event) => {
    const e = ev as unknown as PointerLike;
    if (!this.bus || (e.button !== 0 && e.button !== 2)) return;
    const screen = this.toScreen(e);
    this.dragButton = e.button;
    this.last = screen;
    // 드래그 중 포인터가 HUD 패널 위로 지나가도 놓치지 않도록 캡처
    const el = this.target as unknown as { setPointerCapture?: (id: number) => void };
    if (e.pointerId !== undefined) {
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        // 캡처를 지원하지 않는 환경(테스트 등)
      }
    }
    if (e.button === 0) this.bus.publish({ type: "GRAB_PART", screen }, this.name);
  };

  private onMove = (ev: Event) => {
    const e = ev as unknown as PointerLike;
    if (!this.bus) return;
    const screen = this.toScreen(e);
    if (this.dragButton === 0) {
      this.bus.publish({ type: "MOVE_PART", screen }, this.name);
    } else if (this.dragButton === 2 && this.last) {
      this.bus.publish(
        {
          type: "ROTATE_MODEL",
          dYaw: (screen.x - this.last.x) * ROTATE_SENSITIVITY,
          dPitch: (screen.y - this.last.y) * ROTATE_SENSITIVITY,
        },
        this.name,
      );
    } else {
      this.bus.publish({ type: "HOVER", screen }, this.name);
    }
    this.last = screen;
  };

  private onUp = (ev: Event) => {
    const e = ev as unknown as PointerLike;
    if (!this.bus || this.dragButton === null) return;
    if (this.dragButton === 0) {
      this.bus.publish({ type: "RELEASE_PART", screen: this.toScreen(e) }, this.name);
    }
    this.dragButton = null;
  };

  private onContextMenu = (ev: Event) => ev.preventDefault();

  private onWheel = (ev: Event) => {
    const e = ev as unknown as { deltaY: number; preventDefault?: () => void };
    if (!this.bus || this.dragButton !== 0 || !e.deltaY) return;
    e.preventDefault?.();
    this.bus.publish({ type: "ROTATE_PART", dYawDeg: e.deltaY > 0 ? 15 : -15 }, this.name);
  };

  start(bus: CommandBusLike): void {
    this.bus = bus;
    this.target.addEventListener("pointerdown", this.onDown);
    this.target.addEventListener("pointermove", this.onMove);
    this.target.addEventListener("pointerup", this.onUp);
    this.target.addEventListener("lostpointercapture", this.onUp);
    this.target.addEventListener("contextmenu", this.onContextMenu);
    this.target.addEventListener("wheel", this.onWheel, { passive: false } as AddEventListenerOptions);
  }

  stop(): void {
    this.target.removeEventListener("pointerdown", this.onDown);
    this.target.removeEventListener("pointermove", this.onMove);
    this.target.removeEventListener("pointerup", this.onUp);
    this.target.removeEventListener("lostpointercapture", this.onUp);
    this.target.removeEventListener("contextmenu", this.onContextMenu);
    this.target.removeEventListener("wheel", this.onWheel);
    this.bus = null;
    this.dragButton = null;
  }
}
