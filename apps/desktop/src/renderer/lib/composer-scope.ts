/** Capture the owning profile when creating composer atoms, never when writing to them. */
export function composerScope(profileID: string | null | undefined, localScope: string): string {
  return JSON.stringify([profileID ?? null, localScope]);
}
