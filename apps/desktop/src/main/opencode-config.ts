import type { PalotConfigSource } from "../shared/opencode-contract";

export function optionalFiniteNumber(value: number | string | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function command(value: unknown): { executable: string | null; argumentCount: number } {
  if (!Array.isArray(value)) return { executable: null, argumentCount: 0 };
  const items = value.filter((item): item is string => typeof item === "string");
  return { executable: items[0] ?? null, argumentCount: Math.max(0, items.length - 1) };
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function keys(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).toSorted()
    : [];
}

export function configFormatters(value: unknown): PalotConfigSource["formatters"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([id, item]) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const config = item as Record<string, unknown>;
    return [
      {
        id,
        disabled: config.disabled === true,
        ...command(config.command),
        extensions: strings(config.extensions),
        environmentVariables: keys(config.environment),
      },
    ];
  });
}

export function configLanguageServers(value: unknown): PalotConfigSource["languageServers"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([id, item]) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const config = item as Record<string, unknown>;
    return [
      {
        id,
        disabled: config.disabled === true,
        ...command(config.command),
        extensions: strings(config.extensions),
        environmentVariables: keys(config.env),
        initializationKeys: keys(config.initialization),
      },
    ];
  });
}
