import type { SessionInboxInfo } from "@opencode/client";
import { describe, expect, it } from "vitest";
import {
  moveQueuedInputFirst,
  queueDisplayRows,
  QueueReorderError,
  type QueueReorderApi,
} from "./composer-queue-reorder";
import type { PendingRequestView } from "./view-models";

type InboxUser = Extract<SessionInboxInfo, { type: "user" }>;

function user(id: string, delivery: "queue" | "steer" = "queue"): InboxUser {
  return {
    id,
    sessionID: "ses_1",
    time: { created: 1 },
    type: "user",
    payload: { text: `text of ${id}` },
    delivery,
  } as InboxUser;
}

/** An inbox that delivers in admission order, like OpenCode's. */
function fakeInbox(initial: SessionInboxInfo[]) {
  let items = [...initial];
  let next = 0;
  const api: QueueReorderApi & { failAdmit?: (id: string) => boolean } = {
    list: async () => items,
    admit: async (id, item) => {
      if (api.failAdmit?.(id)) throw new Error("file is gone");
      items = [...items, { ...item, id }];
    },
    cancel: async (id) => {
      items = items.filter((item) => item.id !== id);
    },
    newID: () => `copy_${++next}`,
  };
  return {
    api,
    texts: () => items.map((item) => `${(item as InboxUser).payload.text}:${item.delivery}`),
    ids: () => items.map((item) => item.id),
    deliver: (id: string) => {
      items = items.filter((item) => item.id !== id);
    },
  };
}

describe("moveQueuedInputFirst", () => {
  it("re-admits the other queued messages behind it and leaves steers alone", async () => {
    const inbox = fakeInbox([user("a"), user("s", "steer"), user("b"), user("c")]);
    const copied: Array<[string, string]> = [];
    await expect(
      moveQueuedInputFirst(inbox.api, "c", {
        copied: (original, copy) => copied.push([original, copy]),
      }),
    ).resolves.toBe("moved");
    expect(inbox.texts()).toEqual([
      "text of s:steer",
      "text of c:queue",
      "text of a:queue",
      "text of b:queue",
    ]);
    // The moved message keeps its ID; the others continue as copies.
    expect(inbox.ids()).toEqual(["s", "c", "copy_1", "copy_2"]);
    expect(copied).toEqual([
      ["a", "copy_1"],
      ["b", "copy_2"],
    ]);
  });

  it("does nothing when the message is already first, gone, or the queue is empty", async () => {
    const inbox = fakeInbox([user("a"), user("b")]);
    await expect(moveQueuedInputFirst(inbox.api, "a")).resolves.toBe("unchanged");
    await expect(moveQueuedInputFirst(inbox.api, "missing")).resolves.toBe("unchanged");
    await expect(moveQueuedInputFirst(fakeInbox([]).api, "a")).resolves.toBe("unchanged");
    expect(inbox.ids()).toEqual(["a", "b"]);
  });

  it("keeps every message, in its old order, when a copy cannot be admitted", async () => {
    const inbox = fakeInbox([user("a"), user("b"), user("c"), user("d")]);
    inbox.api.failAdmit = (id) => id === "copy_2";
    const withdrawn: string[] = [];
    const error = await moveQueuedInputFirst(inbox.api, "d", {
      withdrawn: (copy) => withdrawn.push(copy),
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(QueueReorderError);
    expect((error as Error).message).toContain("file is gone");
    expect((error as QueueReorderError).duplicates).toBe(0);
    expect(inbox.ids()).toEqual(["a", "b", "c", "d"]);
    expect(withdrawn).toEqual(["copy_1", "copy_2"]);
  });

  it("withdraws the copy of a message delivered while the copies went in", async () => {
    const inbox = fakeInbox([user("a"), user("b")]);
    const admit = inbox.api.admit;
    inbox.api.admit = async (id, item) => {
      await admit(id, item);
      // The running turn ends and OpenCode delivers the head of the queue.
      inbox.deliver("a");
    };
    await expect(moveQueuedInputFirst(inbox.api, "b")).resolves.toBe("moved");
    expect(inbox.ids()).toEqual(["b"]);
  });

  it("keeps the original when it cannot be withdrawn, rather than queueing it twice", async () => {
    const inbox = fakeInbox([user("a"), user("b")]);
    const cancel = inbox.api.cancel;
    inbox.api.cancel = async (id) => {
      if (id === "a") throw new Error("busy");
      await cancel(id);
    };
    await expect(moveQueuedInputFirst(inbox.api, "b")).rejects.toThrow("kept its place");
    expect(inbox.ids()).toEqual(["a", "b"]);
  });

  it("refuses while OpenCode has other work queued", async () => {
    const compaction = {
      id: "cmp",
      sessionID: "ses_1",
      time: { created: 1 },
      type: "compaction",
      payload: {},
      delivery: "queue",
    } as unknown as SessionInboxInfo;
    const inbox = fakeInbox([user("a"), compaction, user("b")]);
    await expect(moveQueuedInputFirst(inbox.api, "b")).rejects.toBeInstanceOf(QueueReorderError);
    expect(inbox.ids()).toEqual(["a", "cmp", "b"]);
  });
});

describe("queueDisplayRows", () => {
  const view = (id: string, delivery: "queue" | "steer" = "queue") =>
    ({ id, delivery }) as PendingRequestView;

  it("shows a copy as the message it stands for, once, in the order a move heads for", () => {
    const aliases = new Map([["copy_a", "a"]]);
    // Mid-move: the original and its copy are both in the inbox.
    const rows = queueDisplayRows(
      [view("a"), view("s", "steer"), view("b"), view("copy_a")],
      aliases,
      ["b", "a"],
    );
    expect(rows.map((row) => [row.key, row.request.id])).toEqual([
      ["b", "b"],
      ["s", "s"],
      ["a", "a"],
    ]);
    // After the move the copy keeps the original's key, so its row is not remounted.
    expect(
      queueDisplayRows([view("s", "steer"), view("b"), view("copy_a")], aliases, null).map(
        (row) => row.key,
      ),
    ).toEqual(["s", "b", "a"]);
  });
});
