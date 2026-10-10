import type { GestureEvent } from "./types";

type Listener = (event: GestureEvent) => void;
const listeners = new Set<Listener>();

export const gestureEventBus = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  publish(event: GestureEvent): void {
    for (const l of [...listeners]) l(event);
  },
};
