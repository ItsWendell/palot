import { expect, type Page } from "@playwright/test";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const OBJECTIVE = "Add a usage section to the README";
const EDITED = "Add a usage section with an install example to the README";
const FIRST_TURN = "Started on the usage section.";
const EDITED_TURN = "Adding the install example now.";
const SECOND_TURN = "Added the usage section with an example.";
const MET = "The README now has a usage section with an example.";

/**
 * OpenCode 2.2.1's built-in `/goal`: started from Palot's composer, paused by the reviewer,
 * resumed and met from the goal card. The scripted model answers both the agent's turns and
 * the reviewer's verdicts, in order.
 */
export const goalScenario: Scenario = {
  description:
    "start a /goal from the composer, see it pause with the reviewer's reason, edit its objective in place, resume it from the goal card, and dismiss it once met, with continuations hidden",
  prompt: "",
  expectedModelCalls: 8,
  arrange(llm) {
    llm.text(FIRST_TURN);
    // Two unusable verdicts: the reviewer retries once, then OpenCode pauses the goal.
    llm.text("I think it is mostly fine.");
    llm.text("Still thinking about it.");
    // Editing the objective sets the goal again, which starts a turn; the reviewer pauses it again.
    llm.text(EDITED_TURN);
    llm.text("Not sure yet.");
    llm.text("Hard to say.");
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
    await expect(composer).toHaveJSProperty("value", "/goal ");
    await composer.pressSequentially(OBJECTIVE);
    await composer.press("Enter");

    // The goal is a tab on the composer's top edge; its panel holds the details and actions.
    const tab = goalTab(page);
    await expect(tab).toHaveText(/Goal · paused/, { timeout: 60_000 });
    await tab.click();
    const card = page.getByRole("region", { name: "Goal" }).locator("[data-palot-goal-card]");
    await expect(card).toHaveAttribute("data-palot-goal-card", "paused");
    await expect(card).toContainText("Goal paused");
    await expect(card).toContainText("The goal reviewer gave no usable verdict");
    await page.screenshot({ path: join(runRoot, "goal-paused.png") });

    // A new objective while a goal is unfinished asks first; declining keeps the goal.
    await composer.pressSequentially("/goal");
    await page.getByRole("option", { name: /\/goal/ }).waitFor();
    // Picking the command places the caret at once, so typing straight after lands after it.
    await composer.press("Enter");
    await composer.pressSequentially("Something else entirely");
    await composer.press("Enter");
    const replace = page.getByRole("alertdialog", { name: "Replace the current goal?" });
    await expect(replace).toBeVisible();
    await replace.getByRole("button", { name: "Cancel" }).click();
    await expect(composer).toHaveJSProperty("value", "/goal Something else entirely");
    await composer.fill("");

    // Edit changes the objective in place; saving sets the goal again and it starts working.
    await card.getByRole("button", { name: "Edit goal" }).click();
    const objective = card.getByRole("textbox", { name: "Goal objective" });
    await expect(objective).toBeFocused();
    await objective.fill(EDITED);
    await expect(card).toContainText("restarts from round 1");
    await page.screenshot({ path: join(runRoot, "goal-edit.png") });
    await card.getByRole("button", { name: "Save goal" }).click();
    await expect(objective).toHaveCount(0);
    await expect(page.getByText(EDITED_TURN)).toBeVisible({ timeout: 60_000 });
    await expect(card).toHaveAttribute("data-palot-goal-card", "paused", { timeout: 60_000 });
    await expect(card).toContainText(EDITED);

    await card.getByRole("button", { name: "Resume goal" }).click();
    await expect(card).toHaveAttribute("data-palot-goal-card", "complete", { timeout: 60_000 });
  },
  async assert(page, { client, session, runRoot }) {
    const panel = page.getByRole("region", { name: "Goal" });
    if (!(await panel.isVisible())) await goalTab(page).click();
    const card = panel.locator("[data-palot-goal-card]");
    await expect(card).toContainText("Goal met");
    await expect(goalTab(page)).toHaveText("Goal met");
    await expect(card.getByText(new RegExp(`Reviewer: ${MET}`))).toBeVisible();
    // Resuming starts a new budget, so the met goal took one round.
    await expect(card.getByText(/1 of 50 rounds · Updated/)).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: join(runRoot, "goal-met.png") });

    // The kickoff is one notice row; the agent's turns show; OpenCode's continuation and
    // kickoff instructions stay out of the transcript.
    await expect(page.getByText(`Goal: ${OBJECTIVE}`)).toBeVisible();
    await expect(page.getByText(`Goal: ${EDITED}`)).toBeVisible();
    await expect(card).toContainText(EDITED);
    await expect(page.getByText(FIRST_TURN)).toBeVisible();
    await expect(page.getByText(SECOND_TURN)).toBeVisible();
    await expect(page.getByText("Continue working toward the active goal")).toHaveCount(0);
    await expect(page.getByText("A goal is now active for this session")).toHaveCount(0);

    await card.getByRole("button", { name: "Dismiss goal" }).click();
    await expect(card).toHaveCount(0);
    await expect(goalTab(page)).toHaveCount(0);
    const result = await client.rpc.call({
      rpcID: "opencode.goal",
      method: "get",
      location: { directory: session.location.directory },
      input: { sessionID: session.id },
    });
    expect(result.output ?? null).toBeNull();
  },
};

function goalTab(page: Page) {
  return page.getByRole("toolbar", { name: "Task context" }).getByRole("button", { name: /^Goal/ });
}
