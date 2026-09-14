import { createContext, useContext } from "react";
import { useAtomValue } from "jotai";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";

/** A settings view can inspect another server without moving the task's runtime. */
export const SettingsOwnerContext = createContext<OpenCodeRuntimeStatus | null | undefined>(
  undefined,
);

export function useSettingsOwner() {
  const owner = useContext(SettingsOwnerContext);
  const selected = useAtomValue(runtimeAtom);
  return owner === undefined ? selected : owner;
}
