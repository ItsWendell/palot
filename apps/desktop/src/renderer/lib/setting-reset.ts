/** Whether a setting differs from its default, and how to put the default back. */
export interface SettingReset {
  changed: boolean;
  onReset(): void;
}

/** Structural equality for persisted setting values (JSON-like data). */
export function sameSettingValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameSettingValue(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  const otherKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  return (
    keys.length === otherKeys.length &&
    keys.every((key) => Object.hasOwn(right, key) && sameSettingValue(left[key], right[key]))
  );
}

/** Builds a row's reset state from its current value and the value it starts with. */
export function settingReset<T>(
  value: T,
  defaultValue: T,
  setValue: (next: T) => void,
): SettingReset {
  return {
    changed: !sameSettingValue(value, defaultValue),
    onReset: () => setValue(defaultValue),
  };
}
