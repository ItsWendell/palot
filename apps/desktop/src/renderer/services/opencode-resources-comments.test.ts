import { expect, it, vi } from "vitest";
import { sendPrompt } from "./opencode-resources";

const mocks = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue({ location: { directory: "/repo with space" } }),
  prompt: vi
    .fn()
    .mockResolvedValue({ id: "msg-1", sessionID: "session-1", type: "user", time: { created: 1 } }),
}));
vi.mock("./opencode-client", () => ({
  openCodeClient: () => ({ session: { get: mocks.get, prompt: mocks.prompt } }),
}));

it("sends a comment-only prompt with explicit note, file-range context and upstream presentation metadata", async () => {
  await sendPrompt({
    sessionID: "session-1",
    text: "",
    comments: [
      {
        path: "src/a b.ts",
        selection: { startLine: 2, startChar: 0, endLine: 4, endChar: 0 },
        comment: "Handle null.",
        origin: "review",
      },
    ],
  });

  expect(mocks.get).toHaveBeenCalledWith({ sessionID: "session-1" }, expect.anything());
  expect(mocks.prompt).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionID: "session-1",
      text: "The user made the following comment regarding lines 2 through 4 of src/a b.ts: Handle null.",
      files: [{ uri: "file:///repo%20with%20space/src/a%20b.ts?start=2&end=4", name: "a b.ts" }],
      metadata: expect.objectContaining({
        displayText: "",
        comments: [expect.objectContaining({ path: "src/a b.ts", origin: "review" })],
      }),
    }),
    expect.anything(),
  );
});
