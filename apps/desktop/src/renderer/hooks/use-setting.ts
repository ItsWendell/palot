import { useAtom } from "jotai";
import type { PersistedAtom } from "../atoms/persisted";
import { settingReset, type SettingReset } from "../lib/setting-reset";

/**
 * A persisted setting with its reset state, read from the default its atom declares.
 * Pass the third item to `SettingsRow`'s `reset`.
 */
export function useSetting<T>(atom: PersistedAtom<T>): [T, (next: T) => void, SettingReset] {
  const [value, setValue] = useAtom(atom);
  return [value, setValue, settingReset(value, atom.defaultValue, setValue)];
}
