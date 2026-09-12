import { isPtyNotFoundError, type LocationRef, type Pty } from "@opencode/client";
import type { PalotApi, PalotPty, PalotPtySnapshot, PalotPtyTransport } from "../../shared";
import { openCodeClient } from "./opencode-client";

const location = (value: LocationRef) => ({
  directory: value.directory,
  ...(value.workspaceID ? { workspace: value.workspaceID } : {}),
});

function desktopApi(): PalotApi | null {
  return typeof window === "undefined" ? null : (window.palot ?? null);
}

function mapLegacyPty(pty: Pty): PalotPty {
  return { id: pty.id, title: pty.title, status: pty.status, transport: "legacy" };
}

export async function listPtys(value: LocationRef): Promise<PalotPty[]> {
  return (await openCodeClient().pty.list({ location: location(value) })).data.map(mapLegacyPty);
}

export async function createPty(
  sessionID: string,
  value: LocationRef,
  connectionID?: string,
): Promise<PalotPty> {
  const api = desktopApi();
  if (api) {
    const target = connectionID ?? (await api.runtimeStatus()).connectionID;
    return api.createPty({ sessionID, location: value }, target);
  }
  return mapLegacyPty(
    (
      await openCodeClient(connectionID).pty.create({
        location: location(value),
        cwd: value.directory,
        title: "Terminal",
      })
    ).data,
  );
}

export async function getPty(
  value: LocationRef,
  ptyID: string,
  transport: PalotPtyTransport,
): Promise<PalotPty> {
  if (transport === "persistent") {
    const pty = await openCodeClient().experimental.persistentPty.get({ ptyID });
    return { id: pty.id, title: pty.title, status: pty.status, transport };
  }
  return mapLegacyPty((await openCodeClient().pty.get({ ptyID, location: location(value) })).data);
}

export async function snapshotPty(ptyID: string): Promise<PalotPtySnapshot> {
  const snapshot = await openCodeClient().experimental.persistentPty.snapshot({ ptyID });
  const checkpoint = new TextDecoder().decode(
    Uint8Array.from(atob(snapshot.checkpoint), (character) => character.charCodeAt(0)),
  );
  return {
    buffer: checkpoint || snapshot.text,
    cursor: snapshot.info.output.tail,
    cols: snapshot.info.size.cols,
    rows: snapshot.info.size.rows,
  };
}

export function ptyNotFound(error: unknown, depth = 0): boolean {
  if (depth > 5 || !error || typeof error !== "object") return false;
  if (isPtyNotFoundError(error)) return true;
  return "cause" in error && ptyNotFound(error.cause, depth + 1);
}

export async function resizePty(
  value: LocationRef,
  ptyID: string,
  transport: PalotPtyTransport,
  size: { cols: number; rows: number },
): Promise<void> {
  if (transport === "persistent") {
    await openCodeClient().experimental.persistentPty.update({ ptyID, size });
    return;
  }
  await openCodeClient().pty.update({ ptyID, location: location(value), size });
}

export async function removePty(
  value: LocationRef,
  ptyID: string,
  transport: PalotPtyTransport,
): Promise<void> {
  if (transport === "persistent") {
    await openCodeClient().experimental.persistentPty.remove({ ptyID });
    return;
  }
  await openCodeClient().pty.remove({ ptyID, location: location(value) });
}
