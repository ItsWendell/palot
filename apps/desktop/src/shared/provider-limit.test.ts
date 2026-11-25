import { describe, expect, it } from "vitest";
import {
  formatLimitReset,
  providerLimit,
  providerLimitError,
  providerLimitSummary,
} from "./provider-limit";

// Session errors as OpenCode 2.4.1 records them (packages/core/test/session-error.test.ts).
const freeBody = JSON.stringify({
  type: "error",
  error: { type: "FreeUsageLimitError", message: "Rate limit exceeded. Please try again later." },
});
const goBody = JSON.stringify({
  type: "error",
  error: { type: "GoUsageLimitError", message: "Go usage limit exceeded" },
  metadata: { workspace: "wrk_go_limit", limitName: "5 hour" },
});
const modelBudgetBody = JSON.stringify({
  type: "error",
  error: { type: "BudgetLimitError", message: "A budget policy for this model has been reached." },
  metadata: { coverage: "models", resetsAt: "2026-11-01T00:00:00.000Z" },
});
// Google clients get Google's envelope, with the same metadata in its ErrorInfo.
const budgetBody = JSON.stringify({
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message: "Policy budget exceeded",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "BudgetLimitError",
        domain: "opencode.ai",
        metadata: { coverage: "all", resetsAt: "2026-11-01T00:00:00.000Z" },
      },
    ],
  },
});
const chatgptBody = JSON.stringify({
  error: { code: "subscription_sharing_usage_limit_exceeded", message: "Limit" },
});
const workspaceBody = JSON.stringify({
  error: {
    code: "subscription_sharing_workplace_individual_usage_limit_exceeded",
    message: "Limit",
  },
});

// Local noon, so reset times read the same in every time zone.
const failedAt = new Date(2026, 10, 24, 12, 0, 0).getTime();
const budgetReset = Date.UTC(2026, 10, 1);

function limitOf(error: Record<string, unknown>, options?: { modelName?: string }) {
  return providerLimit(providerLimitError(error), failedAt, options);
}

describe("provider limits", () => {
  it("names the free tier with when it lifts", () => {
    expect(
      limitOf({
        type: "provider.free-limit",
        message: "Free usage limit reached.",
        status: 429,
        response: { body: freeBody },
        retryAfterMs: 3_600_000,
      }),
    ).toEqual({
      kind: "free-limit",
      title: "Free usage limit reached",
      resetsAt: failedAt + 3_600_000,
      resets: true,
      link: null,
      adminRequest: null,
    });
  });

  it("names the Go window and links its workspace's Go page for Extra Usage", () => {
    expect(
      limitOf({
        type: "provider.go-limit",
        status: 429,
        response: { body: goBody },
        retryAfterMs: 120_000,
      }),
    ).toMatchObject({
      kind: "go-limit",
      title: "OpenCode Go 5 hour limit reached",
      resetsAt: failedAt + 120_000,
      link: { label: "Turn on Extra Usage", url: "https://opencode.ai/console/wrk_go_limit/go" },
    });
    // Without a workspace (or with one that is not an ID) the link opens Console itself.
    expect(limitOf({ type: "provider.go-limit" })).toMatchObject({
      title: "OpenCode Go usage limit reached",
      resetsAt: null,
      link: { url: "https://opencode.ai/console" },
    });
    expect(
      limitOf({
        type: "provider.go-limit",
        response: { body: JSON.stringify({ metadata: { workspace: "../evil" } }) },
      })?.link?.url,
    ).toBe("https://opencode.ai/console");
  });

  it("reads a budget's reset from its refusal, whichever envelope carries it", () => {
    expect(
      limitOf(
        { type: "provider.model-budget-limit", status: 429, response: { body: modelBudgetBody } },
        { modelName: "GPT-5.5" },
      ),
    ).toMatchObject({
      kind: "model-budget-limit",
      title: "GPT-5.5 spend limit reached",
      resetsAt: budgetReset,
      resets: true,
    });
    expect(
      limitOf({ type: "provider.model-budget-limit", response: { body: modelBudgetBody } })?.title,
    ).toBe("Model spend limit reached");
    expect(
      limitOf({ type: "provider.budget-limit", status: 429, response: { body: budgetBody } }),
    ).toMatchObject({
      kind: "budget-limit",
      title: "Workspace usage limit reached",
      resetsAt: budgetReset,
    });
    expect(limitOf({ type: "provider.budget-limit", message: "budget" })?.resetsAt).toBeNull();
  });

  it("links ChatGPT usage for the plan limit and asks the admin for the workspace one", () => {
    expect(limitOf({ type: "provider.chatgpt-limit", response: { body: chatgptBody } })).toEqual({
      kind: "chatgpt-limit",
      title: "ChatGPT usage limit reached",
      resetsAt: null,
      resets: true,
      link: { label: "ChatGPT usage", url: "https://chatgpt.com/settings/usage" },
      adminRequest: null,
    });
    const workspace = limitOf({
      type: "provider.chatgpt-workspace-limit",
      response: { body: workspaceBody },
    });
    expect(workspace).toMatchObject({
      kind: "chatgpt-workspace-limit",
      title: "ChatGPT workspace limit reached",
      link: null,
    });
    expect(workspace?.adminRequest).toContain("admin.openai.com");
  });

  it("keeps quotas, empty balances and rate limits apart", () => {
    expect(limitOf({ type: "provider.quota", status: 429, retryAfterMs: 60_000 })).toMatchObject({
      kind: "quota",
      title: "Usage limit reached",
      resetsAt: failedAt + 60_000,
    });
    // OpenCode answers an empty balance with 402; it never resets, whatever wait it sent.
    expect(limitOf({ type: "provider.quota", status: 402, retryAfterMs: 60_000 })).toMatchObject({
      kind: "out-of-credits",
      title: "Out of credits",
      resetsAt: null,
      resets: false,
    });
    expect(limitOf({ name: "provider.rate-limit" })?.title).toBe("Rate limited");
    expect(limitOf({ type: "provider.auth" })).toBeNull();
    expect(providerLimitError({ message: "no type" })).toBeNull();
  });

  it("rejects unusable waits and allows Go's monthly window", () => {
    for (const retryAfterMs of [-1, Number.NaN, 46 * 86_400_000])
      expect(limitOf({ type: "provider.quota", retryAfterMs })?.resetsAt).toBeNull();
    expect(limitOf({ type: "provider.go-limit", retryAfterMs: 25 * 86_400_000 })?.resetsAt).toBe(
      failedAt + 25 * 86_400_000,
    );
  });

  it("sums a limit up in one line, with the reset only while it is ahead", () => {
    const limit = limitOf({ type: "provider.free-limit", retryAfterMs: 3_600_000 })!;
    expect(providerLimitSummary(limit, failedAt, "en-GB")).toBe(
      "Free usage limit reached · resets 13:00",
    );
    expect(providerLimitSummary(limit, failedAt + 7_200_000, "en-GB")).toBe(
      "Free usage limit reached",
    );
    expect(formatLimitReset(failedAt + 3 * 86_400_000, failedAt, "en-GB")).toBe("27 Nov, 12:00");
    // Budgets reset at midnight: the day says it all.
    expect(formatLimitReset(new Date(2026, 11, 1).getTime(), failedAt, "en-GB")).toBe("1 Dec");
  });
});
