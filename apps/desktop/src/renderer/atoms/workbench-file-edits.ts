import { atom } from "jotai";
import type { FileEditSession } from "../components/workbench-tabs/file-save";

/** Drafts are window-local, never persisted with workbench descriptors. */
export const workbenchFileEditsAtom = atom(new Map<string, FileEditSession>());
