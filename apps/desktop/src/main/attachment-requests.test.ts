import { describe, expect, it } from "vitest";
import { createAttachmentRequests } from "./attachment-requests";

describe("attachment request ownership", () => {
  it("does not let another window or an old request cancel an upload", () => {
    const requests = createAttachmentRequests();
    const first = requests.start(1, "same-id");
    const second = requests.start(2, "same-id");
    requests.cancel(1, "old-id");
    expect(first.signal.aborted).toBe(false);
    requests.cancel(1, "same-id");
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    first.dispose();
    second.dispose();
  });

  it("bounds concurrent requests and releases ownership after completion", () => {
    const requests = createAttachmentRequests();
    const first = requests.start(1, "first");
    expect(() => requests.start(1, "second")).toThrow("already pending");
    first.dispose();
    const second = requests.start(1, "second");
    first.dispose();
    requests.cancel(1, "second");
    expect(second.signal.aborted).toBe(true);
    second.dispose();
  });
});
