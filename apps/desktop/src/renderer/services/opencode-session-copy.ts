import type { LocationRef } from "@opencode/client";
import { openCodeClient } from "./opencode-client";
import { openCodeRequestSignal } from "./opencode-request";
import { mapSession } from "./opencode-mappers";

/** Copy a standalone transcript. The import contract rejects existing session IDs. */
export async function copySessionToServer(input: {
  sessionID: string;
  sourceConnectionID: string;
  destinationConnectionID: string;
  location: LocationRef;
}) {
  if (input.sourceConnectionID === input.destinationConnectionID)
    throw new Error("Choose a different server for the copy.");
  const source = openCodeClient(input.sourceConnectionID);
  const destination = openCodeClient(input.destinationConnectionID);
  const signal = openCodeRequestSignal();
  const transfer = await source.session.export(
    { sessionID: input.sessionID, sanitize: false },
    { signal },
  );
  const imported = await destination.session.import(
    {
      ...transfer,
      info: { ...transfer.info, parentID: undefined },
      location: input.location,
    },
    { signal },
  );
  // A failed verification must never remove the original or retry the import automatically.
  try {
    const verified = await destination.session.export(
      { sessionID: imported.id, sanitize: false },
      { signal },
    );
    if (
      verified.info.id !== imported.id ||
      stablePayload(verified.messages) !== stablePayload(transfer.messages)
    )
      throw new Error("The copied transcript differs from the source.");
    return mapSession(verified.info);
  } catch (cause) {
    throw new Error(
      "The destination accepted the copy, but its transcript could not be verified. The original is unchanged. Check the destination before retrying.",
      { cause },
    );
  }
}

function stablePayload(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.keys(entry)
            .sort()
            .map((key) => [key, entry[key]]),
        )
      : entry,
  );
}
