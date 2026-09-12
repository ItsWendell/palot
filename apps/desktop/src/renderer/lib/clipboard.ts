export function writeClipboardText(value: string): Promise<void> {
  return window.palot.writeClipboardText(value);
}
