import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn<() => Promise<Uint8Array>>() }));

vi.mock("../services/palot", () => ({
  palot: { readWorkspaceFile: mocks.read },
}));

import { workspaceFileQueryOptions } from "./use-workspace-file";

describe("workspace file reads", () => {
  it("keep the cached bytes when a refresh reads the same file, so previews don't reload", async () => {
    const client = new QueryClient();
    const options = workspaceFileQueryOptions("connection", { directory: "/repo" }, "guide.pdf");
    mocks.read.mockResolvedValueOnce(new Uint8Array([37, 80, 68, 70]));
    const first = await client.fetchQuery(options);

    mocks.read.mockResolvedValueOnce(new Uint8Array([37, 80, 68, 70]));
    await client.refetchQueries({ queryKey: options.queryKey });
    expect(client.getQueryData(options.queryKey)).toBe(first);

    mocks.read.mockResolvedValueOnce(new Uint8Array([37, 80, 68, 71]));
    await client.refetchQueries({ queryKey: options.queryKey });
    const changed = client.getQueryData(options.queryKey);
    expect(changed).not.toBe(first);
    expect(changed).toEqual(new Uint8Array([37, 80, 68, 71]));
    client.clear();
  });
});
