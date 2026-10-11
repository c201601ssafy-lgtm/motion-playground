// handFrameBus의 양손 프레임 → 양손 제스처 명령 (P5-7)

import type { CommandBusLike, CommandSource } from "../commands/types";
import type { HandFrameListener } from "../hand-tracking/frameBus";
import { TwoHandDetector } from "./twoHand";

type Subscribe = (listener: HandFrameListener) => () => void;

export class TwoHandCommandSource implements CommandSource {
  readonly name = "gesture";
  private unsub: (() => void) | null = null;
  private readonly detector = new TwoHandDetector();

  constructor(
    private readonly subscribe: Subscribe,
    private readonly now: () => number = () => performance.now(),
  ) {}

  start(bus: CommandBusLike): void {
    this.unsub = this.subscribe((_frame, _timing, hands) => {
      const command = this.detector.update(hands, this.now());
      if (command) bus.publish(command, this.name);
    });
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    this.detector.reset();
  }
}
