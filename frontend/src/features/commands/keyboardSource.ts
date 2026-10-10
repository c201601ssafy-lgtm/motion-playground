import { MODES } from "../../modes";
import type { Command, CommandBusLike, CommandSource } from "./types";

/** 키보드 → Command. E=분해, A=전체 조립, R=단계 리셋, Esc=취소, 방향키=모델 회전, [ ]=잡은 부품 회전, 1~7=모드. */

const ROTATE_STEP = Math.PI / 18; // 10°

export const KEY_BINDINGS: Record<string, Command> = {
  e: { type: "EXPLODE" },
  a: { type: "ASSEMBLE_ALL" },
  r: { type: "RESET_STEP" },
  escape: { type: "CANCEL" },
  arrowleft: { type: "ROTATE_MODEL", dYaw: -ROTATE_STEP, dPitch: 0 },
  arrowright: { type: "ROTATE_MODEL", dYaw: ROTATE_STEP, dPitch: 0 },
  arrowup: { type: "ROTATE_MODEL", dYaw: 0, dPitch: -ROTATE_STEP },
  arrowdown: { type: "ROTATE_MODEL", dYaw: 0, dPitch: ROTATE_STEP },
  "[": { type: "ROTATE_PART", dYawDeg: -15 },
  "]": { type: "ROTATE_PART", dYawDeg: 15 },
  ...Object.fromEntries(MODES.map((m) => [m.key, { type: "SET_MODE", mode: m.id } as Command])),
};

interface KeyLike {
  key: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
}

function isTyping(target: unknown): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || !!el.isContentEditable);
}

export class KeyboardCommandSource implements CommandSource {
  readonly name = "keyboard";
  private bus: CommandBusLike | null = null;

  constructor(private readonly target: EventTarget) {}

  private onKey = (ev: Event) => {
    const e = ev as unknown as KeyLike;
    if (!this.bus || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const command = KEY_BINDINGS[e.key.toLowerCase()];
    if (!command) return;
    if (e.repeat && !command.type.startsWith("ROTATE")) return;
    this.bus.publish(command, this.name);
  };

  start(bus: CommandBusLike): void {
    this.bus = bus;
    this.target.addEventListener("keydown", this.onKey);
  }

  stop(): void {
    this.target.removeEventListener("keydown", this.onKey);
    this.bus = null;
  }
}
