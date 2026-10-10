import type { Command, CommandBusLike } from "./types";

export interface CommandEnvelope {
  command: Command;
  source: string;
  timestamp: number;
}

type Listener = (envelope: CommandEnvelope) => void;

export class CommandBus implements CommandBusLike {
  private listeners = new Set<Listener>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(command: Command, source: string): void {
    const envelope = { command, source, timestamp: this.now() };
    for (const listener of [...this.listeners]) listener(envelope);
  }
}

export const commandBus = new CommandBus();
