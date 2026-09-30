import type { Protocol } from "devtools-protocol";
import { abortError, type Cdp } from "./cdp";

export async function mouseClick(
  cdp: Pick<Cdp, "send">,
  point: () => Promise<{ x: number; y: number }>,
  signal: AbortSignal,
  button: Protocol.Input.MouseButton = "left",
  count = 1,
  modifiers: readonly string[] = [],
) {
  abortError(signal);
  const position = await point();
  abortError(signal);
  const flags = modifiers.reduce(
    (mask, key) => mask | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[key] ?? 0),
    0,
  );
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...position,
    modifiers: flags,
  });
  for (let clickCount = 1; clickCount <= count; clickCount++) {
    abortError(signal);
    try {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...position,
        button,
        clickCount,
        modifiers: flags,
      });
    } finally {
      // Release any pending press off-target before stopping; cancellation cannot undo page effects.
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...(signal.aborted ? { x: -1, y: -1 } : position),
        button,
        clickCount,
        modifiers: flags,
      });
    }
    abortError(signal);
  }
}
