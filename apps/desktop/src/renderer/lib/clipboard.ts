/** Writes plain text, with an HTML version beside it when given. */
export function writeClipboardText(value: string, html?: string): Promise<void> {
  return html === undefined
    ? window.palot.writeClipboardText(value)
    : window.palot.writeClipboardText(value, html);
}
