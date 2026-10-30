import { atom } from "jotai";
import type { LocationRef } from "@opencode/client";

/** Last focused file per task; opening Files must not forget the file being revealed. */
export const workspaceFileSelectionAtom = atom<
  Record<string, { location: LocationRef; path: string }>
>({});
