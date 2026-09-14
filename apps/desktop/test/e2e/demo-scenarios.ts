import type { OpenCodeClient } from "@opencode/client";
import { expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Scenario } from "./scenarios.ts";
import type { TestLLMScript } from "./test-llm-server.ts";

const execFileAsync = promisify(execFile);
const question = "Should archived sessions appear in the project search results?";
const answer =
  "Got it. I’ll make archive visibility an explicit part of the search contract, so the query layer and the interface use the same rule. I’ll also cover restoring an archived result without losing the current search.";
const palotTitle = "Design conversation state";
const openCodeTitle = "Review PR #418: event batching";
const questionTitle = "Design project session search";
const cleanupTitle = "Clean up inbox state";
const cancellationTitle = "Audit client cancellation";
const architectureOpening = "I’m mapping the ownership boundaries";
const prompts = {
  architecture: [
    "Design the architecture for Palot’s conversation state before we add more workbench features.",
    "Right now the transcript, composer drafts, pending questions, and inbox status all update on different schedules, and it’s getting difficult to reason about what happens when someone switches projects during a response.",
    "Trace the current ownership boundaries and propose a small set of modules with clear responsibilities. Keep OpenCode as the source of truth for session state, but make draft preservation and scroll restoration local to Palot.",
    "Compare an incremental refactor with a larger store redesign, explain the trade-offs, and give me a migration plan that doesn’t require rewriting the whole renderer. Don’t change code yet.",
  ].join(" "),
  review: [
    "Review PR #418, which batches session events before delivering them to connected clients.",
    "Focus on correctness under concurrent sessions rather than formatting or naming. I’m particularly concerned about a final text delta arriving after the idle event, reconnects during an active tool call, and one busy session delaying updates for everything else.",
    "Read the implementation and the affected tests, then trace at least one failure case through the producer, batching queue, and client subscription. Check whether cancellation actually releases the subscription and any queued timers.",
    "Report only actionable findings with a concrete reproduction, severity, and the relevant file locations. Separate confirmed bugs from missing test coverage, and don’t modify the branch.",
  ].join(" "),
  cleanup: [
    "Clean up the duplicated inbox state logic in Palot’s project and workspace sidebars.",
    "Both views derive running, unread, and needs-input states, but the conditions have drifted and it’s too easy to fix one without fixing the other. Extract the shared decision into a small pure module and leave rendering, sorting, and navigation with the components that own them.",
    "Preserve the current behavior for archived sessions, child tasks, and a completed task that still has an unanswered question. Avoid a generic abstraction or a new state-management dependency.",
    "After the refactor, run the focused tests and add regression coverage for any ambiguous precedence rules. Summarize what changed and call out anything you deliberately left alone.",
  ].join(" "),
  cancellation: [
    "Audit cancellation handling in the OpenCode client examples and session helpers.",
    "We use these patterns in a desktop app where people switch tasks, close panes, and disconnect from servers while requests are still in flight. Check that the documented AbortSignal behavior matches the generated client contract, especially for event subscriptions and requests that are shared by more than one consumer.",
    "Find examples that accidentally swallow a real network error as a cancellation or leave a subscription alive after the caller has gone away. Keep any edits limited to the examples and small helpers; don’t add a wrapper around the generated client.",
    "Give me a short summary of the corrected patterns and any upstream contract gaps that still need a separate decision.",
  ].join(" "),
  search: [
    "Plan project-scoped session search for OpenCode, including how Palot should consume it.",
    "People need to find an older conversation by title or message content without loading every transcript into the renderer. Propose the query contract, pagination strategy, and result shape, including enough context to explain why a session matched.",
    "Cover renamed projects, archived sessions, and child tasks without leaking results across directories. Keep the initial implementation small enough to ship independently from a full-text indexing redesign.",
    "Before writing code, identify product decisions that affect the API and ask me about those rather than choosing silently. I’d like a concrete implementation plan and a few representative request and response examples once those choices are settled.",
  ].join(" "),
};

// This fixture runs through the real service and renderer. Only the model is fake.
// One response deliberately remains queued for the question the user can answer.
export const demoScenarios: Record<
  "demo-workspace",
  Scenario & { pendingModelResponses: number; projectName: string }
> = {
  "demo-workspace": {
    description: "interactive Palot/OpenCode workspace with slow streams and an inbox question",
    prompt: "",
    expectedModelCalls: 8,
    pendingModelResponses: 1,
    projectName: "palot",
    async prepareProject({ projectDirectory, runRoot }) {
      for (const [directory, name] of [
        [projectDirectory, "palot"],
        [join(runRoot, "opencode"), "opencode"],
      ] as const) {
        await mkdir(directory, { recursive: true });
        await execFileAsync("git", ["init", "--quiet"], { cwd: directory });
        await writeFile(join(directory, "package.json"), JSON.stringify({ name, private: true }));
        await writeFile(join(directory, "README.md"), `# ${name}\n\nDisposable demo project.\n`);
        await execFileAsync("git", ["add", "."], { cwd: directory });
        await execFileAsync(
          "git",
          [
            "-c",
            "user.name=Palot Demo",
            "-c",
            "user.email=demo@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--quiet",
            "-m",
            `Seed ${name} demo`,
          ],
          { cwd: directory },
        );
      }
    },
    arrange(llm) {
      llm.route(prompts.cleanup, (script) =>
        script.text(
          [
            "Extracted the shared inbox-state decision into a pure selector used by both sidebars. The components still own their row layout, sorting, and navigation.",
            "",
            "- Pending questions take precedence over completed or unread status, so a task that needs input stays visible.",
            "- Archived sessions remain excluded unless the view explicitly includes them.",
            "- Child-task activity contributes to its parent without creating a duplicate top-level row.",
            "",
            "The focused selector and sidebar checks pass. I added coverage for a completed session with a pending question and a running child under an idle parent. I left the connection-loading states and the existing sort order alone; neither needs to change for this cleanup.",
          ].join("\n"),
        ),
      );
      llm.route(prompts.cancellation, (script) =>
        script.text(
          [
            "The examples now distinguish caller cancellation from a failed request. Previously, the catch-all early return could hide a server error after a task switch.",
            "",
            "For ordinary requests, pass the caller’s signal in the request options and only suppress an error when that caller was actually aborted. For event subscriptions, end the consumer’s iterator when its owner unmounts; don’t tear down the shared connection while another subscriber is using it.",
            "",
            "I kept the generated client unchanged. The examples now show cleanup beside subscription setup, with separate handling for connection failures. The remaining gap is service startup: cancellation of the caller does not establish that a service contender has stopped, so that needs a separate lifecycle decision rather than another client wrapper.",
          ].join("\n"),
        ),
      );
      llm.route(prompts.search, (script) => {
        // Exercise answering once during setup, then leave the same choice pending.
        for (let attempt = 0; attempt < 2; attempt++) {
          script.tool("question", {
            questions: [
              {
                header: "Archived sessions",
                question,
                options: [
                  {
                    label: "Explicit filter",
                    description: "Keep the default results focused on active work.",
                  },
                  {
                    label: "Always include",
                    description: "Search every session, including archived work.",
                  },
                ],
              },
            ],
          });
          script.text(answer);
        }
      });
      llm.route(prompts.architecture, (script) => {
        script.text(
          [
            "I’d take the incremental refactor. A larger store redesign would move a lot of code before we’ve established which state actually needs to be shared.",
            "",
            "- **Session resources:** own the OpenCode snapshot, event subscription, and connection lifecycle.",
            "- **Conversation view state:** owns the local draft, scroll anchor, and expanded tool results, keyed by connection and session.",
            "- **Inbox projection:** derives attention and activity from session resources without depending on the mounted conversation.",
            "",
            "The important boundary is that navigating away disposes the view, not the session. A background task must keep receiving events, while an unsent draft must never become part of the server’s transcript. I’ll trace a project switch during streaming before proposing the module interfaces and migration order.",
          ].join("\n"),
        );
        slowReview(script, [
          `${architectureOpening} around a project switch while the assistant is still responding. That gives us a useful test case for the proposed design: the old conversation unmounts, its session keeps running, and the new composer restores a different draft.`,
          "### Resource ownership",
          "The session resource should expose a snapshot plus a subscription, with one owner responsible for reconciling incoming events. Its key needs both the connection ID and session ID. The view can release its subscription without destroying resources still needed by the inbox or another pane.",
          "A pending question belongs to that resource, not to the composer component. Otherwise switching tabs can hide the request or accidentally attach a reply to whichever conversation is currently selected.",
          "### Local view state",
          "Keep drafts and scroll anchors in a separate session-keyed store. Restoring a conversation should hydrate its transcript first, then restore the anchor once that message exists. If the user was following the latest response, restore follow mode instead of replaying an obsolete pixel offset.",
          "I would avoid persisting expanded tool results in the first pass. That is reversible presentation state, and including it now would expand the migration without protecting user input.",
          "### Migration order",
          "1. Extract the inbox projection and lock down attention precedence with focused tests.\n2. Move draft ownership out of the mounted composer, keeping its public interface unchanged.\n3. Introduce the session-resource boundary behind the existing transcript hook.\n4. Move scroll restoration last, once hydration timing has a single owner.",
          "The acceptance check is a two-project flow: type an unsent draft, switch while the other project streams, answer its question, then return. The draft must survive, the inbox must stay current, and answering must never depend on which pane had focus. This can be delivered incrementally without maintaining two competing copies of server state.",
        ]);
      });
      llm.route(prompts.review, (script) =>
        slowReview(script, [
          "I’m tracing the batching queue before commenting on the diff. The main question is whether it preserves ordering for a single session without making unrelated sessions wait for the same flush.",
          "### Final delta and idle ordering",
          "I’m following a response that emits a final text delta immediately before becoming idle. If the delta remains queued while the idle event bypasses the batch, a client can mark the response complete before it receives the last words. A timer-only test would miss this unless it asserts the delivered event sequence, not just the eventual text.",
          "The reproduction needs a nonempty queue, an idle transition before the next scheduled flush, and a subscriber that records both events. I’m checking whether the terminal-event path drains the queue synchronously or merely requests another flush.",
          "### Cancellation and reconnects",
          "Next I’m checking what owns the flush timer after the last subscriber leaves. Clearing the listener is not enough if the timer retains the session buffer. Reconnecting should establish a new subscription without replaying an abandoned buffer over the hydrated snapshot.",
          "A second subscriber matters here. Cancelling one consumer must not clear work still needed by the other, so the cleanup test should exercise two consumers with different lifetimes.",
          "### Cross-session fairness",
          "I’m comparing a continuously streaming session with a second session that only emits a short tool result. If every new delta resets a shared deadline, the quiet session can wait indefinitely even though its result is ready. A fixed maximum flush interval or independent queues would avoid that, but I’ll check the current scheduler before recommending either.",
          "I’ll separate confirmed failures from coverage gaps in the final review. Missing assertions alone are not proof of a bug; each finding needs the exact producer-to-client sequence that fails and a focused regression test that demonstrates it.",
        ]),
      );
    },
    async run(page, { client, session, projectDirectory, runRoot, llm }) {
      await client.session.rename({ sessionID: session.id, title: palotTitle });
      await client.session.prompt({
        sessionID: session.id,
        text: prompts.architecture,
      });
      await client.session.wait({ sessionID: session.id });
      const openCodeDirectory = join(runRoot, "opencode");
      for (const [directory, title, text] of [
        [projectDirectory, cleanupTitle, prompts.cleanup],
        [openCodeDirectory, cancellationTitle, prompts.cancellation],
      ] as const) {
        const completed = await createTask(client, directory, title);
        await client.session.prompt({ sessionID: completed.id, text });
        await client.session.wait({ sessionID: completed.id });
        // Do not acknowledge these: they should appear as unread completed work.
      }

      const decision = await createTask(client, openCodeDirectory, questionTitle);
      await client.session.prompt({ sessionID: decision.id, text: prompts.search });
      await navigate(page, decision.id);
      const panel = page.locator("[data-palot-composer-request]");
      await expect(panel.getByText(question, { exact: true })).toBeVisible();
      await panel.locator('input[value="Explicit filter"]').check();
      await panel.getByRole("button", { name: "Send", exact: true }).click();
      await client.session.wait({ sessionID: decision.id });
      await expect(page.getByText(answer, { exact: true })).toBeVisible();
      await client.session.prompt({
        sessionID: decision.id,
        text: "Before we commit to the API shape, let’s revisit archive visibility. Some people use search to recover old work, while others expect it to reflect only the active project. Present the two options again so we can make that trade-off explicitly before implementation.",
      });
      await expect(panel.getByText(question, { exact: true })).toBeVisible();

      const running = await createTask(client, openCodeDirectory, openCodeTitle);
      await client.session.prompt({ sessionID: running.id, text: prompts.review });
      await client.session.prompt({
        sessionID: session.id,
        text: "The incremental approach sounds right. Work through the case where I switch from Palot to OpenCode while both sessions are streaming, then return to a composer with an unsent draft. Be explicit about which subscriptions stay alive, who owns pending questions, and when scroll restoration runs. Sketch the module boundaries and migration order, but keep this at the design stage until we’ve agreed on the ownership model.",
      });
      await llm.waitForCalls(8);
      await navigate(page, session.id);
      await page.getByRole("button", { name: /^Show inbox/ }).click();
      await expect(page.getByLabel("Inbox navigation", { exact: true })).toBeVisible();
      await writeFile(
        join(runRoot, "demo.json"),
        JSON.stringify({ palot: session.id, opencode: running.id, question: decision.id }, null, 2),
        { mode: 0o600 },
      );
    },
    async assert(page, { runRoot }) {
      await expect(
        page.getByLabel("Current task").getByText(palotTitle, { exact: true }),
      ).toBeVisible();
      const inbox = page.getByLabel("Inbox navigation", { exact: true });
      for (const title of [openCodeTitle, questionTitle, cleanupTitle, cancellationTitle]) {
        await expect(inbox.getByText(title, { exact: true })).toBeVisible();
      }
      const response = page.getByText(architectureOpening, { exact: false });
      await expect(response).toBeVisible();
      await expect(page.getByRole("button", { name: "Stop task", exact: true })).toBeEnabled();
      // Prove streaming continues after the staged workspace is already usable.
      const textLength = async () => (await response.innerText()).length;
      const initialLength = await textLength();
      await expect.poll(textLength).toBeGreaterThan(initialLength);
      await page.screenshot({ path: join(runRoot, "demo.png") });
      console.log(
        "Demo ready: two projects, two slow streams, two unread results, and an answerable question.",
      );
      console.log(
        "Scripted streams finish in about three minutes. Browse freely; rerun bun run demo to reset. Ctrl-C cleans up.",
      );
    },
  },
};

async function createTask(client: OpenCodeClient, directory: string, title: string) {
  const session = await client.session.create({ location: { directory } });
  await client.session.rename({ sessionID: session.id, title });
  return session;
}

async function navigate(page: Page, sessionID: string) {
  await page.evaluate((id) => {
    window.location.hash = `#/sessions/${id}`;
  }, sessionID);
  await page.getByLabel("Current task").waitFor();
}

function slowReview(script: TestLLMScript, sections: string[]) {
  // Small word groups produce a readable stream rather than a wall of instant text.
  script.textChunks(sections.join("\n\n").match(/\S+\s*/g) ?? [], 550);
}
