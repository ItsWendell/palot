import type { LocationRef } from "@opencode/client";
import type {
  OpenWorkbenchTabInput,
  OpenWorkbenchTabOptions,
  OpenWorkbenchTabResult,
} from "../lib/workbench-tabs";
import { palot } from "./palot";

export async function openNewWorkbenchTerminal(
  sessionID: string,
  location: LocationRef,
  openTab: (
    input: OpenWorkbenchTabInput,
    options?: OpenWorkbenchTabOptions,
  ) => OpenWorkbenchTabResult | undefined,
  options: OpenWorkbenchTabOptions = { pane: "bottom" },
  connectionID?: string,
): Promise<OpenWorkbenchTabResult> {
  const pty = await palot.createPty(sessionID, location, connectionID);
  const result = openTab(
    { kind: "terminal", location, ptyID: pty.id, sessionID, transport: pty.transport },
    options,
  );
  if (result?.ok) return result;
  await palot.removePty(location, pty.id, pty.transport).catch(() => undefined);
  throw new Error("Close a workbench tab before opening another terminal");
}
