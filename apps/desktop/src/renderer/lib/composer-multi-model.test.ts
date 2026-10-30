import { expect, it, vi } from "vitest";
import type { PalotModel, PalotSession } from "../../shared";
import { sendToSeveralModels } from "./composer-multi-model";

const models = [
  { id: "a", providerID: "one", name: "Alpha" },
  { id: "a", providerID: "two", name: "Beta" },
] as PalotModel[];
it("creates independent sibling tasks and reports partial failure without retrying a send", async () => {
  const create = vi.fn(
    async (_model, title) => ({ id: `session-${create.mock.calls.length}`, title }) as PalotSession,
  );
  const send = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("Receipt lost"));
  const results = await sendToSeveralModels({ models, text: "same prompt", create, send });
  expect(results.map((result) => result.sent)).toEqual([true, false]);
  expect(results[1]?.session?.id).toBe("session-2");
  expect(results[1]?.error).toBe("Receipt lost");
  expect(create.mock.calls[0]![1].split(" · ").slice(0, 2)).toEqual(
    create.mock.calls[1]![1].split(" · ").slice(0, 2),
  );
  expect(send).toHaveBeenCalledTimes(2);
});
it("refuses repeated models and out-of-bounds fanout before creating anything", async () => {
  const create = vi.fn();
  for (const selected of [[models[0]!], [models[0]!, models[0]!], Array(5).fill(models[0]!)]) {
    await expect(
      sendToSeveralModels({ models: selected, text: "prompt", create, send: vi.fn() }),
    ).rejects.toThrow("two to four");
  }
  expect(create).not.toHaveBeenCalled();
});
