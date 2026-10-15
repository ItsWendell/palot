type ShortcutInput = Pick<
  Electron.Input,
  "type" | "key" | "code" | "control" | "meta" | "alt" | "shift"
>;

/**
 * Tab keys an embedded page never receives, as in a browser: the platform close key
 * (⌘W on macOS, Ctrl+W elsewhere) and Ctrl+Tab with or without Shift. Main swallows them
 * before the page and the window menu, and the workbench decides what they do.
 */
export function isWorkbenchTabShortcut(input: ShortcutInput, platform: NodeJS.Platform): boolean {
  if (input.type !== "keyDown" || input.alt) return false;
  if (input.key === "Tab") return input.control && !input.meta;
  if (input.shift) return false;
  const close = platform === "darwin" ? input.meta && !input.control : input.control && !input.meta;
  if (!close) return false;
  // Follow the typed letter on remapped layouts; fall back to the physical key for non-Latin ones.
  return /^[a-z]$/i.test(input.key) ? input.key.toLowerCase() === "w" : input.code === "KeyW";
}
