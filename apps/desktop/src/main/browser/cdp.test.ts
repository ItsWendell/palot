// @vitest-environment node
import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { expect, it, vi } from "vitest";
import { createCdp } from "./cdp";

it("releases debugger listeners after native WebContents destruction", async () => {
  let destroyed = false;
  const debuggerAPI = Object.assign(new EventEmitter(), {
    isAttached: () => true,
    sendCommand: vi.fn(async () => ({})),
  });
  const contents = {
    isDestroyed: () => destroyed,
    get debugger() {
      if (destroyed) throw new Error("Object has been destroyed");
      return debuggerAPI;
    },
  } as unknown as WebContents;
  const cdp = createCdp(contents);
  const receive = vi.fn();
  cdp.on("Page.loadEventFired", receive);
  expect(debuggerAPI.listenerCount("message")).toBe(1);
  destroyed = true;
  expect(() => cdp.dispose()).not.toThrow();
  expect(debuggerAPI.listenerCount("message")).toBe(0);
  debuggerAPI.emit("message", {}, "Page.loadEventFired", {});
  expect(receive).not.toHaveBeenCalled();
  await expect(cdp.send("Page.enable")).rejects.toThrow("Browser tab was closed");
  expect(debuggerAPI.sendCommand).not.toHaveBeenCalled();
});
