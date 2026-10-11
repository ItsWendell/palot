import { atom } from "jotai";
import type { PaletteTab } from "../lib/global-command-search";

/**
 * A request to run a global palette command by ID from outside the palette, such as a
 * composer slash command. The always-mounted palette owns the command registry and runs it.
 */
export interface GlobalCommandRequest {
  commandID: string;
  nonce: number;
}

export const globalCommandRequestAtom = atom<GlobalCommandRequest | null>(null);

let nextNonce = 0;

export const requestGlobalCommandAtom = atom(null, (_get, set, commandID: string) => {
  nextNonce += 1;
  set(globalCommandRequestAtom, { commandID, nonce: nextNonce });
});

/** Palette task actions that the open task's composer performs with its own draft and menus. */
export type ComposerAction = "undo" | "redo" | "model" | "agent";

export interface ComposerActionRequest {
  action: ComposerAction;
  /** Owning profile, or `null` for the focused connection. */
  profileID: string | null;
  sessionID: string;
  requestedAt: number;
}

export const composerActionRequestAtom = atom<ComposerActionRequest | null>(null);

/** The palette's filter tab, shared so `/open` can show the palette on Files. */
export const commandPaletteTabAtom = atom<PaletteTab>("all");
