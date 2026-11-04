import { expect, type Locator, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gitPrScenario } from "./git-pr-scenario.ts";
import type { Scenario } from "./scenarios.ts";

const exec = promisify(execFile);
const PROMPT = "Show the GitHub HTML fixture.";
const REPLY = [
  "Use <kbd>Ctrl</kbd>+<kbd>K</kbd> to search, then read the notes.",
  "",
  "<details>",
  "<summary>Release notes <b>v2</b></summary>",
  "",
  "The renderer streams **Markdown** inside an open details element.",
  "",
  "- First point",
  "- Second point with <mark>highlight</mark>",
  "",
  "</details>",
  "",
  "| Key | Action |",
  "| --- | --- |",
  "| <kbd>J</kbd> | Next<br>file |",
  "| <kbd>K</kbd> | Previous<br>file |",
  "",
  'H<sub>2</sub>O and E = mc<sup>2</sup>, see <a href="https://example.com/docs">the docs</a>.',
].join("\n");
// Small chunks split tags mid-name and mid-attribute, so held-back tails are exercised.
const CHUNKS = REPLY.match(/[\s\S]{1,7}/g)!;

/** Dependabot pull request body as GitHub serves it (raw HTML blocks inside Markdown). */
const DEPENDABOT_BODY = `Bumps the go_modules group with 1 update in the /go-platform directory: [github.com/go-jose/go-jose/v4](https://github.com/go-jose/go-jose).

Updates \`github.com/go-jose/go-jose/v4\` from 4.1.4 to 4.1.6
<details>
<summary>Release notes</summary>
<p><em>Sourced from <a href="https://github.com/go-jose/go-jose/releases">github.com/go-jose/go-jose/v4's releases</a>.</em></p>
<blockquote>
<h2>v4.1.6</h2>
<h2>Fixed Security Issues</h2>
<ul>
<li>Reject mismatched JWE CEK lengths by <a href="https://github.com/akshithg"><code>@&#8203;akshithg</code></a> in <a href="https://redirect.github.com/go-jose/go-jose/pull/266">go-jose/go-jose#266</a></li>
</ul>
</blockquote>
</details>
<details>
<summary>Commits</summary>
<ul>
<li><a href="https://github.com/go-jose/go-jose/commit/a0111f8"><code>a0111f8</code></a> Merge commit from fork</li>
<li>See full diff in <a href="https://github.com/go-jose/go-jose/compare/v4.1.4...v4.1.6">compare view</a></li>
</ul>
</details>
<br />

[![Dependabot compatibility score](https://dependabot-badges.githubapp.com/badges/compatibility_score?dependency-name=github.com/go-jose/go-jose/v4&package-manager=go_modules&previous-version=4.1.4&new-version=4.1.6)](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updates#about-compatibility-scores)

Dependabot will resolve any conflicts with this PR as long as you don't alter it yourself.

---

<details>
<summary>Dependabot commands and options</summary>
<br />

You can trigger Dependabot actions by commenting on this PR:
- \`@dependabot rebase\` will rebase this PR
- \`@dependabot recreate\` will recreate this PR, overwriting any edits that have been made to it

</details>`;

/** Literal tag text in rendered Markdown outside code means raw HTML leaked through as text. */
async function literalTags(container: Locator): Promise<string[]> {
  return container.evaluateAll((roots) =>
    roots.flatMap((root) => {
      const found: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest("pre, code")) continue;
        const match = node.textContent?.match(/<\/?[A-Za-z][^\s>]*/);
        if (match) found.push(match[0]);
      }
      return found;
    }),
  );
}

async function screenshotBothSchemes(page: Page, runRoot: string, name: string) {
  const appearance = await page.evaluate(() => ({
    preferences: window.palot.appearancePreferences,
    resolvedScheme:
      document.documentElement.dataset.resolvedTheme === "dark"
        ? ("dark" as const)
        : ("light" as const),
  }));
  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate(
      async ({ preferences, scheme }) => {
        await window.palot.updateAppearance({
          preferences: { ...preferences, mode: scheme },
          resolvedScheme: scheme,
        });
      },
      { preferences: appearance.preferences, scheme },
    );
    await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", scheme);
    await page.screenshot({ path: join(runRoot, `markdown-html-${name}-${scheme}.png`) });
  }
  await page.evaluate(async (appearance) => {
    await window.palot.updateAppearance(appearance);
  }, appearance);
}

export const markdownHtmlScenario: Scenario = {
  description:
    "stream an agent reply with details, kbd and table <br> HTML without literal tags, and render a Dependabot PR description",
  prompt: "",
  expectedModelCalls: 1,
  arrange(llm) {
    llm.textChunks(CHUNKS, 25);
  },
  async prepareProject(context) {
    await gitPrScenario.prepareProject!(context);
    const git = (...args: string[]) => exec("git", ["-C", context.projectDirectory, ...args]);
    await git("add", "feature.txt");
    await git("commit", "-m", "Fixture feature");
    await git("push", "-u", "origin", "feature");
    const { stdout } = await git("rev-parse", "HEAD");
    await writeFile(
      join(context.runRoot, "github-state.json"),
      JSON.stringify({
        created: true,
        oid: stdout.trim(),
        title: "Bump github.com/go-jose/go-jose/v4 from 4.1.4 to 4.1.6",
        body: DEPENDABOT_BODY,
      }),
    );
  },
  async run(page, { client, session, runRoot }) {
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, session.id);
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();

    // Record any literal tag text that appears in the transcript while the reply streams.
    await page.evaluate(() => {
      const leaks: string[] = [];
      const check = (node: Node) => {
        if (node.nodeType !== Node.TEXT_NODE) return;
        const parent = node.parentElement;
        if (!parent?.closest(".markdown") || parent.closest("pre, code")) return;
        const match = node.textContent?.match(/<\/?[A-Za-z][^\s>]*/);
        if (match) leaks.push(match[0]);
      };
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "characterData") check(record.target);
          for (const added of record.addedNodes) {
            check(added);
            if (added instanceof Element) {
              const walker = document.createTreeWalker(added, NodeFilter.SHOW_TEXT);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) check(node);
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
      (window as unknown as { __palotHtmlLeaks: string[] }).__palotHtmlLeaks = leaks;
    });

    await client.session.prompt({ sessionID: session.id, text: PROMPT });
    const reply = page.locator(".markdown").filter({ hasText: "to search, then read" }).last();
    const details = reply.locator("details.markdown-details");
    // While still streaming, the open element already holds the Markdown that follows it.
    await expect(details.locator(".markdown-details-content")).toContainText("The renderer", {
      timeout: 20_000,
    });
    await page.screenshot({ path: join(runRoot, "markdown-html-streaming.png") });
    await client.experimental.session.wait({ sessionID: session.id });
    await expect(reply).toContainText("see the docs.");

    const leaks = await page.evaluate(
      () => (window as unknown as { __palotHtmlLeaks: string[] }).__palotHtmlLeaks,
    );
    expect(leaks).toEqual([]);
    expect(await literalTags(reply)).toEqual([]);
    await expect(reply.locator("kbd")).toHaveText(["Ctrl", "K", "J", "K"]);
    await expect(details.locator("summary")).toHaveText("Release notes v2");
    await expect(details.locator("summary b")).toHaveText("v2");
    await expect(details.locator(".markdown-details-content strong")).toHaveText("Markdown");
    await expect(details.locator(".markdown-details-content li mark")).toHaveText("highlight");
    await expect(reply.locator("td br")).toHaveCount(2);
    await expect(reply.locator("sub")).toHaveText("2");
    await expect(reply.getByRole("link", { name: "the docs" })).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
    await screenshotBothSchemes(page, runRoot, "transcript");

    await page.evaluate(() => {
      location.hash = "/pull-requests?pr=github.com/palot-e2e/fixture/7";
    });
    await expect(
      page.getByRole("heading", {
        name: "Bump github.com/go-jose/go-jose/v4 from 4.1.4 to 4.1.6 #7",
        exact: true,
      }),
    ).toBeVisible({ timeout: 20_000 });
    const description = page.locator(".markdown").filter({ hasText: "Bumps the go_modules" });
    await expect(description.locator("details > summary")).toHaveText([
      "Release notes",
      "Commits",
      "Dependabot commands and options",
    ]);
    expect(await literalTags(description)).toEqual([]);
    const notes = description.locator("details").first();
    await notes.locator("summary").click();
    await expect(notes.getByRole("heading", { name: "v4.1.6", exact: true })).toBeVisible();
    await expect(notes.locator("blockquote li")).toContainText("Reject mismatched JWE CEK lengths");
    await expect(notes.getByRole("link", { name: "go-jose/go-jose#266" })).toHaveAttribute(
      "href",
      "https://redirect.github.com/go-jose/go-jose/pull/266",
    );
    await description.locator("details").nth(2).locator("summary").click();
    await expect(description.locator("details").nth(2).locator("li code")).toHaveText([
      "@dependabot rebase",
      "@dependabot recreate",
    ]);
    // Remote badges stay gated in PR descriptions, as Markdown images do.
    await expect(description.getByText("[Image: Dependabot compatibility score]")).toBeVisible();
    await screenshotBothSchemes(page, runRoot, "pull-request");
    await writeFile(
      join(runRoot, "markdown-html-result.json"),
      JSON.stringify({ streamedChunks: CHUNKS.length, literalTagLeaks: leaks.length }),
    );
  },
  async assert(page) {
    await expect(page.getByText("Dependabot commands and options", { exact: true })).toBeVisible();
  },
};
