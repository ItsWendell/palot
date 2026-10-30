import { expect } from "@playwright/test";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const OBJECTIVE = "Add a usage section to the README";
const FIRST_TURN = "Started on the usage section.";
const SECOND_TURN = "Added the usage section with an example.";
const MET = "The README now has a usage section with an example.";

/**
 * OpenCode 2.2.1's built-in `/goal`: started from Palot's composer, paused by the reviewer,
 * resumed and met from the goal card. The scripted model answers both the agent's turns and
 * the reviewer's verdicts, in order.
 */
export const goalScenario: Scenario = {
  description:
    "start a /goal from the composer, see it pause with the reviewer's reason, resume it from the goal card, and dismiss it once met, with continuations hidden",
  prompt: "",
  expectedModelCalls: 5,
  arrange(llm) {
    llm.text(FIRST_TURN);
    // Two unusable verdicts: the reviewer retries once, then OpenCode pauses the goal.
    llm.text("I think it is mostly fine.");
    llm.text("Still thinking about it.");
    llm.text(SECOND_TURN);
    llm.text(JSON.stringify({ verdict: "done", reason: MET }));
  },
  async run(page, { runRoot }) {
    const composer = page.getByRole("textbox", { name: "Message Palot", exact: true });
    await expect(composer).toBeEditable({ timeout: 30_000 });
    await composer.click();
    await composer.pressSequentially("/goal");
    await page.getByRole("option", { name: /\/goal/ }).waitFor();
    await composer.press("Enter");
    await expect(composer).toHaveValue("/goal ");
    await composer.pressSequentially(OBJECTIVE);
    await composer.press("Enter");

    const card = page.getByRole("region", { name: "Goal" });
    await expect(card).toHaveAttribute("data-palot-goal-card", "paused", { timeout: 60_000 });
    await expect(card).toContainText("Goal paused");
    await expect(card).toContainText("The goal reviewer gave no usable verdict");
    await page.screenshot({ path: join(runRoot, "goal-paused.png") });

    // A new objective while a goal is unfinished asks first; declining keeps the goal.
    // The confirm blocks the page until answered, so answer it as it opens.
    let asked = "";
    page.once("dialog", (dialog) => {
      asked = dialog.message();
      void dialog.dismiss();
    });
    await composer.pressSequentially("/goal");
    await page.getByRole("option", { name: /\/goal/ }).waitFor();
    await composer.press("Enter");
    await composer.pressSequentially("Something else entirely");
    await composer.press("Enter");
    await expect.poll(() => asked).toContain("Replace the current goal?");
    await expect(composer).toHaveValue("/goal Something else entirely");
    await composer.fill("");

    await card.getByRole("button", { name: "Resume goal" }).click();
    await expect(card).toHaveAttribute("data-palot-goal-card", "complete", { timeout: 60_000 });
  },
  async assert(page, { client, session, runRoot }) {
    const card = page.getByRole("region", { name: "Goal" });
    await expect(card).toContainText("Goal met");
    await card.getByRole("button", { name: /Goal met/ }).click();
    await expect(card.getByText(`Reviewer: ${MET}`)).toBeVisible();
    // Resuming starts a new budget, so the met goal took one round.
    await expect(card.getByText(/^1 of 50 rounds · Updated/)).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: join(runRoot, "goal-met.png") });

    // The kickoff is one notice row; the agent's turns show; OpenCode's continuation and
    // kickoff instructions stay out of the transcript.
    await expect(page.getByText(`Goal: ${OBJECTIVE}`)).toBeVisible();
    await expect(page.getByText(FIRST_TURN)).toBeVisible();
    await expect(page.getByText(SECOND_TURN)).toBeVisible();
    await expect(page.getByText("Continue working toward the active goal")).toHaveCount(0);
    await expect(page.getByText("A goal is now active for this session")).toHaveCount(0);

    await card.getByRole("button", { name: "Dismiss" }).click();
    await expect(card).toHaveCount(0);
    const result = await client.rpc.call({
      rpcID: "opencode.goal",
      method: "get",
      location: { directory: session.location.directory },
      input: { sessionID: session.id },
    });
    expect(result.output ?? null).toBeNull();
  },
};
