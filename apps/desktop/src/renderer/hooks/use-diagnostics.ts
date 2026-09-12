import { useEffect, useSyncExternalStore } from "react";
import {
  diagnostics,
  type DiagnosticsDemand,
  type DiagnosticsSnapshot,
} from "../lib/diagnostics-controller";

export function useDiagnostics(demand: DiagnosticsDemand): DiagnosticsSnapshot {
  const snapshot = useSyncExternalStore(
    diagnostics.subscribe,
    diagnostics.getSnapshot,
    diagnostics.getSnapshot,
  );
  useEffect(() => diagnostics.acquire(demand), [demand]);
  return snapshot;
}
