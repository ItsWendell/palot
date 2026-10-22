/** OpenCode 2.0.32 added the experimental `voice.session` route. */
export function supportsOpenCodeVoice(version: string | null | undefined): boolean {
  const match = version?.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  if (major !== 2) return major > 2;
  return minor > 0 || patch >= 32;
}
