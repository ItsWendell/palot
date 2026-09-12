export const MAX_RETAINED_SESSION_VIEWS = 16;

export class SessionViewRetention {
  private readonly recent: string[] = [];

  touch(sessionID: string): void {
    const index = this.recent.indexOf(sessionID);
    if (index >= 0) this.recent.splice(index, 1);
    this.recent.push(sessionID);
  }

  retained(protectedSessionIDs: Iterable<string> = []): Set<string> {
    return new Set([...this.recent.slice(-MAX_RETAINED_SESSION_VIEWS), ...protectedSessionIDs]);
  }
}

export function retainSessionViews<T>(
  values: Map<string, T>,
  retainedSessionIDs: ReadonlySet<string>,
): Map<string, T> {
  if ([...values.keys()].every((sessionID) => retainedSessionIDs.has(sessionID))) return values;
  return new Map([...values].filter(([sessionID]) => retainedSessionIDs.has(sessionID)));
}
