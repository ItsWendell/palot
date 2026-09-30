import type { Protocol } from "devtools-protocol";
import { expect, test, vi } from "vitest";
import type { Cdp } from "./cdp";
import { mouseClick } from "./input";

const position = { x: 100, y: 200 };
const sender = () => vi.fn<Cdp["send"]>().mockResolvedValue({} as never);
const events = (send: ReturnType<typeof sender>) =>
  send.mock.calls.map(([, params]) => params as Protocol.Input.DispatchMouseEventRequest);

test("canceling while coordinates are pending dispatches no input", async () => {
  const send = sender();
  const controller = new AbortController();
  const ready = Promise.withResolvers<typeof position>();
  const click = mouseClick({ send }, () => ready.promise, controller.signal);
  controller.abort();
  ready.resolve(position);
  await expect(click).rejects.toThrow("cancelled");
  expect(send).not.toHaveBeenCalled();
});

test("canceling after pointer movement prevents the press", async () => {
  const controller = new AbortController();
  const send = sender().mockImplementation(async () => {
    controller.abort();
    return {} as never;
  });
  await expect(mouseClick({ send }, async () => position, controller.signal)).rejects.toThrow(
    "cancelled",
  );
  expect(events(send).map((event) => event.type)).toEqual(["mouseMoved"]);
});

test("a canceled press is released off-target without completing a click", async () => {
  const controller = new AbortController();
  const send = sender().mockImplementation(async (_method, params) => {
    if ((params as Protocol.Input.DispatchMouseEventRequest).type === "mousePressed")
      controller.abort();
    return {} as never;
  });
  await expect(mouseClick({ send }, async () => position, controller.signal)).rejects.toThrow(
    "cancelled",
  );
  expect(events(send).map((event) => event.type)).toEqual([
    "mouseMoved",
    "mousePressed",
    "mouseReleased",
  ]);
  expect(events(send).at(-1)).toMatchObject({ x: -1, y: -1, button: "left" });
});

test("uncanceled clicks retain coordinates, click count and modifiers", async () => {
  const send = sender();
  await mouseClick({ send }, async () => position, new AbortController().signal, "right", 2, [
    "Control",
  ]);
  expect(events(send).map((event) => event.type)).toEqual([
    "mouseMoved",
    "mousePressed",
    "mouseReleased",
    "mousePressed",
    "mouseReleased",
  ]);
  expect(events(send).at(-1)).toMatchObject({
    ...position,
    button: "right",
    clickCount: 2,
    modifiers: 2,
  });
});
