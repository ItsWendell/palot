import { atom } from "jotai";

/** Window-local, consumed once by the specific terminal after its shell is ready. */
export const terminalPasteAtom = atom(new Map<string, string>());

export function terminalCommandText(code: string): string {
  // Never allow terminal control sequences (including a forged paste terminator).
  return [...code]
    .filter((char) => {
      const value = char.charCodeAt(0);
      return char === "\n" || char === "\t" || (value >= 32 && (value < 127 || value > 159));
    })
    .join("")
    .trimEnd();
}
