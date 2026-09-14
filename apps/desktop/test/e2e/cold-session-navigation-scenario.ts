import { OpenCode, type SessionMessageInfo } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { expect, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../../package.json" with { type: "json" };
import type { PalotApi } from "../../src/shared/opencode-contract";
import { startLoopbackServiceProxy } from "./loopback-service-proxy.ts";
import type { Scenario } from "./scenarios.ts";

const turns = 60;
const remoteName = "Cold navigation isolated loopback";
type Client = ReturnType<typeof OpenCode.make>;
type Frame = {
  atMs: number;
  mounted: boolean;
  state: string | null;
  opacity: number;
  targetVisible: boolean;
  staleVisible: boolean;
  visibleRows: number;
  bottomGap: number | null;
};
type Probe = {
  clickEpochMs: number;
  mountedMs: number | null;
  settledMs: number | null;
  fullOpacityMs: number | null;
  complete: boolean;
  frames: Frame[];
  stop(): void;
};
type RequestTrace = {
  id: string;
  sessionID: string;
  kind: "transcript" | "prompt-index";
  startMs: number;
  startEpochMs: number;
  outcome?: string;
  durationMs?: number;
  status?: number;
  main?: Record<string, unknown>;
};
type ProbeWindow = Window & {
  __palotColdNavigation?: Probe;
  __palotColdRequests?: { requests: RequestTrace[]; dropped: number; stop(): void };
};

async function seed(client: Client, directory: string, label: string, id: string) {
  const base = await client.session.create({ location: { directory } });
  try {
    const messages: SessionMessageInfo[] = Array.from({ length: turns }, (_, index) => [
      {
        id: `msg_${label}_user_${index}`,
        type: "user" as const,
        time: { created: 1_780_000_000_000 + index * 2_000 },
        text: `${label} prompt ${index + 1}: review this deterministic fixture.`,
      },
      {
        id: `msg_${label}_assistant_${index}`,
        type: "assistant" as const,
        time: {
          created: 1_780_000_000_001 + index * 2_000,
          completed: 1_780_000_000_002 + index * 2_000,
        },
        agent: "build",
        model: { providerID: "test", id: "test-model" },
        finish: "stop" as const,
        content: [
          {
            type: "text" as const,
            text: `## ${label} response ${index + 1}\n\n${Array.from({ length: 12 }, (_, paragraph) => `Paragraph ${paragraph + 1}. Deterministic long transcript content with **emphasis**, inline \`code\`, and enough wrapped text to exercise initial virtual layout.\n\n`).join("")}\n${label} END ${index + 1}`,
          },
        ],
      },
    ]).flat();
    return await client.session.import({
      info: { ...base, id, title: `Cold navigation ${label}`, parentID: undefined },
      messages,
      location: { directory },
    });
  } finally {
    await client.session.remove({ sessionID: base.id });
  }
}

async function measure(page: Page, row: Locator, sessionID: string, label: string) {
  await row.evaluate(
    (button, { sessionID, label, turns }) => {
      const browser = window as ProbeWindow;
      browser.__palotColdNavigation?.stop();
      button.addEventListener(
        "click",
        (event) => {
          const started = event.timeStamp;
          const probe: Probe = {
            clickEpochMs: performance.timeOrigin + started,
            mountedMs: null,
            settledMs: null,
            fullOpacityMs: null,
            complete: false,
            frames: [],
            stop: () => {},
          };
          browser.__palotColdNavigation = probe;
          let frame = 0;
          let viewportCache: Element | null = null;
          let dirty = true;
          let markers: Element[] = [];
          const observer = new MutationObserver(() => {
            dirty = true;
          });
          probe.stop = () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
          };
          const capture = () => {
            const atMs = performance.now() - started;
            const route = new URL(location.hash.slice(1), location.origin);
            const selected = route.pathname === `/sessions/${sessionID}`;
            const viewport = document.querySelector('[aria-label="Task transcript"]');
            const surface = document.querySelector("[data-palot-transcript-surface]");
            if (viewportCache !== viewport) {
              observer.disconnect();
              viewportCache = viewport;
              dirty = true;
              if (viewport)
                observer.observe(viewport, { subtree: true, childList: true, characterData: true });
            }
            if (observer.takeRecords().length) dirty = true;
            if (dirty) {
              markers = Array.from(viewport?.querySelectorAll("p") ?? []).filter((element) =>
                /^(LOCAL|REMOTE) END \d+$/.test(element.textContent?.trim() ?? ""),
              );
              dirty = false;
            }
            const bounds = viewport?.getBoundingClientRect();
            const intersects = (element: Element) => {
              const rect = element.getBoundingClientRect();
              return Boolean(
                bounds && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom,
              );
            };
            const targetVisible = markers.some(
              (element) =>
                element.textContent?.trim() === `${label} END ${turns}` && intersects(element),
            );
            const staleVisible = markers.some(
              (element) =>
                !element.textContent?.trim().startsWith(`${label} END`) && intersects(element),
            );
            const opacity = surface ? Number.parseFloat(getComputedStyle(surface).opacity) : 0;
            const state = surface?.getAttribute("data-palot-transcript-state") ?? null;
            const mounted =
              selected &&
              Boolean(
                viewport &&
                surface &&
                viewport.querySelector(`[data-message-id="msg_${label}_assistant_${turns - 1}"]`),
              );
            const visibleRows = Array.from(
              viewport?.querySelectorAll("[data-message-id]") ?? [],
            ).filter(intersects).length;
            if (mounted && probe.mountedMs === null) probe.mountedMs = atMs;
            if (mounted && state === "visible" && probe.settledMs === null) probe.settledMs = atMs;
            if (
              mounted &&
              state === "visible" &&
              opacity >= 0.99 &&
              targetVisible &&
              probe.fullOpacityMs === null
            )
              probe.fullOpacityMs = atMs;
            probe.frames.push({
              atMs,
              mounted,
              state,
              opacity,
              targetVisible,
              staleVisible,
              visibleRows,
              bottomGap: viewport
                ? viewport.scrollHeight - viewport.clientHeight - Math.max(0, viewport.scrollTop)
                : null,
            });
            // Observe a full second after useful reveal, not a latency/fade budget.
            if (
              (probe.fullOpacityMs !== null && atMs >= probe.fullOpacityMs + 1_000) ||
              atMs >= 30_000 ||
              probe.frames.length >= 4_096
            ) {
              probe.complete = true;
              probe.stop();
            } else frame = requestAnimationFrame(capture);
          };
          frame = requestAnimationFrame(capture);
        },
        { capture: true, once: true },
      );
    },
    { sessionID, label, turns },
  );
  await row.click();
  try {
    await expect
      .poll(() => page.evaluate(() => (window as ProbeWindow).__palotColdNavigation?.complete), {
        timeout: 35_000,
      })
      .toBe(true);
    return await page.evaluate(() => {
      const { stop, ...result } = (window as ProbeWindow).__palotColdNavigation!;
      stop();
      return result;
    });
  } finally {
    await page.evaluate(() => (window as ProbeWindow).__palotColdNavigation?.stop());
  }
}

export const coldSessionNavigationScenario: Scenario = {
  description:
    "measure first-open long local and isolated loopback-remote transcripts without latency or fade budgets",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run() {},
  async assert(page, { client, projectDirectory, runRoot, llm, uncertainCleanup }) {
    const home = join(runRoot, "cold-navigation-remote-home");
    await mkdir(home, { recursive: true, mode: 0o700 });
    const file = join(home, ".local/state/opencode/service.json");
    const original = await page.evaluate(() =>
      (window as unknown as { palot: PalotApi }).palot.listOpenCodeProfiles(),
    );
    let started = false;
    let profileID: string | undefined;
    let proxy: Awaited<ReturnType<typeof startLoopbackServiceProxy>> | undefined;
    const ids = { LOCAL: `ses_${crypto.randomUUID()}`, REMOTE: `ses_${crypto.randomUUID()}` };
    let requests: RequestTrace[] = [];
    let droppedRequests = 0;
    await page.evaluate((ids) => {
      const browser = window as ProbeWindow;
      browser.__palotColdRequests?.stop();
      const originals = { debug: console.debug, warn: console.warn, error: console.error };
      const trace = {
        requests: [] as RequestTrace[],
        dropped: 0,
        stop: () => {
          Object.assign(console, originals);
        },
      };
      browser.__palotColdRequests = trace;
      const tracked = new Map<string, RequestTrace>();
      // Capture existing transport logs before packaged logging can discard debug.
      for (const level of ["debug", "warn", "error"] as const) {
        console[level] = (...args: unknown[]) => {
          try {
            const match =
              typeof args[0] === "string" &&
              args[0].match(
                /^\[opencode-client\] (request started|response|request failed|request cancelled) (\{.*\})$/,
              );
            if (match) {
              const details = JSON.parse(match[2]!) as {
                id: string;
                path: string;
                durationMs?: number;
                status?: number;
                main?: Record<string, unknown>;
              };
              const url = new URL(details.path, "https://opencode.invalid");
              const sessionID = Object.values(ids).find(
                (id) => url.pathname === `/api/session/${id}/message`,
              );
              if (sessionID && match[1] === "request started") {
                if (trace.requests.length < 256) {
                  const startMs = performance.now();
                  const entry: RequestTrace = {
                    id: details.id,
                    sessionID,
                    kind: url.searchParams.has("type") ? "prompt-index" : "transcript",
                    startMs,
                    startEpochMs: performance.timeOrigin + startMs,
                  };
                  trace.requests.push(entry);
                  tracked.set(details.id, entry);
                } else trace.dropped++;
              } else if (sessionID) {
                const entry = tracked.get(details.id);
                if (entry)
                  Object.assign(entry, {
                    outcome: match[1],
                    durationMs: details.durationMs,
                    status: details.status,
                    main: details.main,
                  });
              }
            }
          } catch {
            /* A malformed diagnostic must not break the original logger. */
          }
          originals[level].apply(console, args);
        };
      }
    }, ids);
    const samples: {
      owner: string;
      transport: string;
      sessionID: string;
      profileID: string;
      probe: Awaited<ReturnType<typeof measure>>;
    }[] = [];
    try {
      started = true;
      const endpoint = await Service.ensure({
        file,
        version:
          (
            await page.evaluate(() =>
              (window as unknown as { palot: PalotApi }).palot.runtimeStatus(),
            )
          ).version ?? packageJson.devDependencies["@opencode/client"],
        command: [process.env.OPENCODE_BIN ?? "opencode2", "serve", "--service", "--port=0"],
        env: {
          HOME: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          XDG_DATA_HOME: join(home, ".local/share"),
          XDG_STATE_HOME: join(home, ".local/state"),
          XDG_CACHE_HOME: join(home, ".cache"),
          OPENCODE_TEST_HOME: home,
          OPENCODE_CONFIG_CONTENT: "{}",
          OPENCODE_AUTH_CONTENT: "{}",
          OPENCODE_DISABLE_PROJECT_CONFIG: "1",
          OPENCODE_PURE: "1",
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          OPENCODE_DISABLE_MODELS_FETCH: "1",
        },
      }).catch((cause: unknown) => {
        const message =
          "Secondary isolated Service.ensure failed; public API cannot verify cleanup of an unregistered contender.";
        uncertainCleanup(message);
        throw new Error(message, { cause });
      });
      const remote = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
      proxy = await startLoopbackServiceProxy(endpoint);
      await seed(client, projectDirectory, "LOCAL", ids.LOCAL);
      await seed(remote, projectDirectory, "REMOTE", ids.REMOTE);
      profileID = await page.evaluate(
        async ({ url, name }) => {
          const api = (window as unknown as { palot: PalotApi }).palot;
          const snapshot = await api.createOpenCodeProfile({
            kind: "remote",
            name,
            urls: [url],
            credential: { type: "none" },
            allowPlainHttp: true,
          });
          const profile = snapshot.profiles.find((entry) => entry.name === name)!;
          await api.connectOpenCodeProfile(profile.id);
          window.dispatchEvent(new Event("focus"));
          return profile.id;
        },
        { url: proxy.url, name: remoteName },
      );
      await page.setViewportSize({ width: 1440, height: 920 });
      const inbox = page.getByRole("button", { name: /^Show inbox/ });
      if (!(await inbox.isVisible()))
        await page.getByRole("button", { name: "Show navigation", exact: true }).click();
      await inbox.click();
      await page.getByRole("button", { name: "Inbox options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Enabled servers", exact: true }).hover();
      const monitor = page.getByRole("menuitemcheckbox", {
        name: new RegExp(`^Enable ${remoteName}`),
      });
      await expect(monitor).toBeVisible();
      if ((await monitor.getAttribute("aria-checked")) !== "true") await monitor.click();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      for (const label of ["LOCAL", "REMOTE"] as const) {
        const row = page.getByRole("button", { name: new RegExp(`^Cold navigation ${label} ·`) });
        await expect(row).toBeVisible({ timeout: 30_000 });
        expect(page.url()).not.toContain(ids[label]);
        const probe = await measure(page, row, ids[label], label);
        await page.screenshot({
          path: join(runRoot, `cold-navigation-${label.toLowerCase()}.png`),
        });
        samples.push({
          owner: label.toLowerCase(),
          transport:
            label === "REMOTE"
              ? "isolated secondary service via loopback HTTP proxy, not WAN"
              : "isolated local service",
          sessionID: ids[label],
          profileID: label === "REMOTE" ? profileID : original.activeProfileID,
          probe,
        });
        await expect
          .poll(() => {
            const route = new URL(page.url().split("#")[1]!, "http://e2e.invalid");
            return { path: route.pathname, profileID: route.searchParams.get("profileID") };
          })
          .toEqual({
            path: `/sessions/${ids[label]}`,
            profileID: label === "REMOTE" ? profileID : original.activeProfileID,
          });
      }
      expect(llm.requests).toHaveLength(0);
    } finally {
      // Artifact failures must not skip fixture teardown either.
      try {
        const trace = await page.evaluate(() => {
          const trace = (window as ProbeWindow).__palotColdRequests!;
          trace.stop();
          return { requests: trace.requests, dropped: trace.dropped };
        });
        requests = trace.requests;
        droppedRequests = trace.dropped;
        await writeFile(
          join(runRoot, "cold-session-navigation.json"),
          JSON.stringify(
            {
              metric:
                "trusted click to rAF-observed mounted / visible-state / >=0.99 opacity target DOM; not compositor presentation",
              fixture: { turns, messages: turns * 2, paragraphsPerResponse: 12 },
              viewport: page.viewportSize(),
              requestObservation: requests.length
                ? "Existing opencode-client logs captured before console forwarding; renderer start is monotonic, durationMs and main timings retain transport clock semantics"
                : "Unable to observe matching opencode-client transport logs in this build; counts unavailable, not proof of no fetch",
              droppedRequests,
              samples: samples.map((sample) => ({
                ...sample,
                beforeClickRequests: requests.filter(
                  (request) =>
                    request.sessionID === sample.sessionID &&
                    request.kind === "transcript" &&
                    request.startEpochMs < sample.probe.clickEpochMs,
                ).length,
                transcriptRequestCount: requests.filter(
                  (request) =>
                    request.sessionID === sample.sessionID && request.kind === "transcript",
                ).length,
                promptIndexRequestCount: requests.filter(
                  (request) =>
                    request.sessionID === sample.sessionID && request.kind !== "transcript",
                ).length,
                requests: requests
                  .filter((request) => request.sessionID === sample.sessionID)
                  .map((request) => ({
                    ...request,
                    clickToStartMs: request.startEpochMs - sample.probe.clickEpochMs,
                  })),
              })),
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
      } finally {
        const cleanup = await Promise.allSettled([
          proxy?.close(),
          started ? Service.stop({ file }) : undefined,
          profileID && !page.isClosed()
            ? page.evaluate(
                async ({ originalID, profileID }) => {
                  const api = (window as unknown as { palot: PalotApi }).palot;
                  await api.switchOpenCodeProfile(originalID);
                  await api.deleteOpenCodeProfile(profileID);
                },
                { originalID: original.activeProfileID, profileID },
              )
            : undefined,
        ]);
        const failures = cleanup.filter((result) => result.status === "rejected");
        if (failures.length) {
          uncertainCleanup("Cold navigation secondary service, proxy, or profile cleanup failed");
          console.error(
            new AggregateError(
              failures.map((result) => result.reason),
              "Cold navigation fixture cleanup failed",
            ),
          );
        }
      }
    }
    expect(droppedRequests, "Request trace must not be truncated").toBe(0);
    for (const sample of samples) {
      const transcriptRequests = requests.filter(
        (request) => request.sessionID === sample.sessionID && request.kind === "transcript",
      );
      expect(
        transcriptRequests.length,
        `Unable to observe a cold transcript request for ${sample.owner}; this build must expose existing opencode-client logs`,
      ).toBeGreaterThanOrEqual(1);
      // This fixture needs one rooted page and at most one older-cursor probe.
      // Focus changes must not cancel that work and silently start it again.
      expect(transcriptRequests.length).toBeLessThanOrEqual(2);
      expect(transcriptRequests.every((request) => request.outcome === "response")).toBe(true);
      expect(
        requests.filter(
          (request) =>
            request.sessionID === sample.sessionID &&
            request.kind === "transcript" &&
            request.startEpochMs < sample.probe.clickEpochMs,
        ).length,
        "Target must not have been hydrated before its first click",
      ).toBe(0);
      expect(sample.probe.mountedMs).not.toBeNull();
      expect(sample.probe.settledMs).not.toBeNull();
      expect(sample.probe.fullOpacityMs).not.toBeNull();
      const revealed = sample.probe.frames.filter(
        (frame) => frame.atMs >= sample.probe.fullOpacityMs!,
      );
      expect(revealed.length).toBeGreaterThan(1);
      expect(
        revealed.every(
          (frame) => frame.targetVisible && frame.visibleRows > 0 && !frame.staleVisible,
        ),
        "No stale or blank transcript after reveal",
      ).toBe(true);
      expect(
        revealed.every((frame) => frame.bottomGap !== null && Math.abs(frame.bottomGap) <= 2),
        "Cold transcript remains at its settled live edge",
      ).toBe(true);
    }
  },
};
