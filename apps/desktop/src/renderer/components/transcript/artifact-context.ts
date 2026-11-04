import type { LocationRef } from "@opencode/client";
import { createContext } from "react";

/** The task a transcript belongs to, so artifact cards can read its list and open its browser. */
export interface TranscriptArtifactScope {
  connectionID: string;
  sessionID: string;
  location: LocationRef;
}

export const TranscriptArtifactContext = createContext<TranscriptArtifactScope | null>(null);
