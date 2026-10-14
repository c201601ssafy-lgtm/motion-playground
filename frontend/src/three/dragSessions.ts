/** Independent drag sessions with exclusive ownership of each part. */
export class DragSessions<T extends { partId: string | null }> {
  private sessions = new Map<string, T>();
  constructor(private readonly create: () => T) {}

  get(owner: string): T {
    let session = this.sessions.get(owner);
    if (!session) {
      session = this.create();
      this.sessions.set(owner, session);
    }
    return session;
  }

  claim(owner: string, partId: string): boolean {
    const session = this.get(owner);
    if (session.partId || [...this.sessions].some(([id, s]) => id !== owner && s.partId === partId)) return false;
    session.partId = partId;
    return true;
  }

  values() { return this.sessions.values(); }
  canRotate(owner: string | null): boolean {
    if (![...this.sessions.values()].some((s) => !!s.partId)) return true;
    return owner !== null && !this.sessions.get(owner)?.partId;
  }
  [Symbol.iterator]() { return this.sessions[Symbol.iterator](); }
}
