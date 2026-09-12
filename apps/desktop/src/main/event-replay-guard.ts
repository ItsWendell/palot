import type { OpenCodeEvent } from "@opencode/client";

export class EventReplayGuard {
  readonly #seen = new Set<string>();

  constructor(private readonly limit = 4_096) {}

  admit(event: OpenCodeEvent): boolean {
    const key = eventKey(event);
    if (this.#seen.has(key)) return false;
    this.#seen.add(key);
    if (this.#seen.size > this.limit) {
      const oldest = this.#seen.values().next().value;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
    return true;
  }

  reset(): void {
    this.#seen.clear();
  }
}

function eventKey(event: OpenCodeEvent): string {
  if ("durable" in event && event.durable) {
    return `durable:${event.durable.aggregateID}:${event.durable.seq}`;
  }
  return `event:${event.id}`;
}
