/**
 * OpenCode 2.4.0 (#65034) wraps harness instructions in `<system-update>` (before: `<system-reminder>`):
 * Plan mode and goal reminders arrive as synthetic messages of their own, and the TUI adds notes
 * such as "The user opened the file …" to a prompt. They are for the model, not the reader.
 */
const BLOCK = /<(system-update|system-reminder)>[\s\S]*?<\/\1>\n?/g;
const WHOLE = /^\s*<(system-update|system-reminder)>\s*([\s\S]*?)\s*<\/\1>\s*$/;

/** The text without its instruction blocks; unchanged when it has none. */
export function stripSystemUpdates(text: string): string {
  if (!text.includes("<system-update>") && !text.includes("<system-reminder>")) return text;
  return text.replace(BLOCK, "").trim();
}

/** The instructions, when the whole text is one instruction block. */
export function systemUpdateBody(text: string): string | null {
  return text.match(WHOLE)?.[2] ?? null;
}
