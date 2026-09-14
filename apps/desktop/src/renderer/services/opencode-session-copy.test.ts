import { beforeEach, describe, expect, it, vi } from "vitest";
import { copySessionToServer } from "./opencode-session-copy";

const mocks = vi.hoisted(() => ({ client: vi.fn(), map: vi.fn((value: unknown) => value) }));
vi.mock("./opencode-client", () => ({ openCodeClient: mocks.client }));
vi.mock("./opencode-mappers", () => ({ mapSession: mocks.map }));
vi.mock("./opencode-request", () => ({ openCodeRequestSignal: () => undefined }));

beforeEach(() => vi.clearAllMocks());

describe("copy task to another server", () => {
  const input = {
    sessionID: "ses_source",
    sourceConnectionID: "source",
    destinationConnectionID: "destination",
    location: { directory: "/remote/project" },
  };
  const transfer = {
    info: { id: "ses_source", parentID: "ses_parent", title: "Investigate the parser" },
    messages: [
      { id: "msg_one", type: "user", text: "Preserve this exact question", time: { created: 1 } },
      {
        id: "msg_two",
        type: "assistant",
        content: [{ type: "text", text: "The original answer" }],
        time: { created: 2, completed: 3 },
      },
    ],
  };

  it("captures both owners before exporting, imports a standalone transcript, and verifies the destination", async () => {
    let resolve!: (value: unknown) => void;
    const source = {
      session: {
        export: vi.fn(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        ),
        remove: vi.fn(),
      },
    };
    const destination = {
      session: {
        import: vi.fn().mockResolvedValue(transfer.info),
        export: vi.fn().mockResolvedValue(transfer),
      },
    };
    mocks.client.mockImplementation((id) => (id === "source" ? source : destination));
    const copying = copySessionToServer(input);
    expect(mocks.client.mock.calls).toEqual([["source"], ["destination"]]);
    mocks.client.mockImplementation(() => {
      throw new Error("focus changed");
    });
    resolve(transfer);
    await expect(copying).resolves.toEqual(transfer.info);
    expect(source.session.export).toHaveBeenCalledWith(
      { sessionID: "ses_source", sanitize: false },
      { signal: undefined },
    );
    expect(destination.session.import).toHaveBeenCalledWith(
      { ...transfer, info: { ...transfer.info, parentID: undefined }, location: input.location },
      { signal: undefined },
    );
    expect(destination.session.export).toHaveBeenCalledWith(
      { sessionID: "ses_source", sanitize: false },
      { signal: undefined },
    );
    expect(source.session.remove).not.toHaveBeenCalled();
  });

  it("does not retry or overwrite when the destination rejects a collision", async () => {
    const conflict = new Error("Task already exists on destination");
    const destination = {
      session: { import: vi.fn().mockRejectedValue(conflict), export: vi.fn() },
    };
    mocks.client.mockImplementation((id) =>
      id === "source" ? { session: { export: vi.fn().mockResolvedValue(transfer) } } : destination,
    );
    await expect(copySessionToServer(input)).rejects.toBe(conflict);
    expect(destination.session.import).toHaveBeenCalledTimes(1);
    expect(destination.session.export).not.toHaveBeenCalled();
  });

  it("reports an unverifiable copy without deleting either side", async () => {
    const destination = {
      session: {
        import: vi.fn().mockResolvedValue(transfer.info),
        export: vi.fn().mockResolvedValue({ ...transfer, messages: [] }),
      },
    };
    mocks.client.mockImplementation((id) =>
      id === "source" ? { session: { export: vi.fn().mockResolvedValue(transfer) } } : destination,
    );
    await expect(copySessionToServer(input)).rejects.toThrow("original is unchanged");
  });

  it("rejects copying to the source before issuing requests", async () => {
    await expect(
      copySessionToServer({ ...input, destinationConnectionID: "source" }),
    ).rejects.toThrow("different server");
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("rejects corrupted text even when destination message IDs and count match", async () => {
    const destination = {
      session: {
        import: vi.fn().mockResolvedValue(transfer.info),
        export: vi.fn().mockResolvedValue({
          ...transfer,
          messages: transfer.messages.map((message) =>
            message.id === "msg_one" ? { ...message, text: "[redacted:text:msg_one]" } : message,
          ),
        }),
        remove: vi.fn(),
      },
    };
    mocks.client.mockImplementation((id) =>
      id === "source" ? { session: { export: vi.fn().mockResolvedValue(transfer) } } : destination,
    );
    await expect(copySessionToServer(input)).rejects.toThrow("destination accepted the copy");
    expect(destination.session.import).toHaveBeenCalledOnce();
    expect(destination.session.remove).not.toHaveBeenCalled();
  });

  it("warns that a copy exists when post-import verification times out, without retrying", async () => {
    const destination = {
      session: {
        import: vi.fn().mockResolvedValue(transfer.info),
        export: vi.fn().mockRejectedValue(new Error("Verification timed out")),
        remove: vi.fn(),
      },
    };
    mocks.client.mockImplementation((id) =>
      id === "source" ? { session: { export: vi.fn().mockResolvedValue(transfer) } } : destination,
    );
    await expect(copySessionToServer(input)).rejects.toThrow(
      "Check the destination before retrying",
    );
    expect(destination.session.import).toHaveBeenCalledOnce();
    expect(destination.session.export).toHaveBeenCalledOnce();
    expect(destination.session.remove).not.toHaveBeenCalled();
  });

  it("accepts identical content with reordered object keys", async () => {
    const destination = {
      session: {
        import: vi.fn().mockResolvedValue(transfer.info),
        export: vi.fn().mockResolvedValue({
          ...transfer,
          messages: transfer.messages.map((message) =>
            Object.fromEntries(Object.entries(message).reverse()),
          ),
        }),
      },
    };
    mocks.client.mockImplementation((id) =>
      id === "source" ? { session: { export: vi.fn().mockResolvedValue(transfer) } } : destination,
    );
    await expect(copySessionToServer(input)).resolves.toEqual(transfer.info);
  });
});
