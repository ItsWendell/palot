import { Service } from "@opencode/client/service";
import { expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, request, type ClientRequest, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { PalotApi } from "../../src/shared/opencode-contract";
import { startLoopbackServiceProxy } from "./loopback-service-proxy.ts";
import type { Scenario } from "./scenarios";

const historicalCount = 300;
const profileName = "Cold history attention fixture";

export const startupAttentionScenario: Scenario = {
  description:
    "Loaded-location attention finds an idle external form without waiting for project metadata or opening 300 injected cold projects",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run() {},
  async assert(page, { client, runRoot }) {
    // Check storage isolation before creating a profile, not only during cleanup.
    const persistedProfiles = JSON.parse(
      await readFile(join(runRoot, "palot-user-data/opencode-connections.json"), "utf8"),
    );
    expect(persistedProfiles).toMatchObject({
      activeProfileID: "local-default",
      profiles: [{ id: "local-default" }],
    });
    // Discover only this harness's explicit registration. Never discover or
    // restart the shared user service, and never boot the historical directories.
    const endpoint = await Service.discover({
      file: join(runRoot, "home/.local/state/opencode/service.json"),
    });
    if (!endpoint) throw new Error("Owned E2E service registration is unavailable");
    const coldRoot = join(runRoot, "missing-historical-projects");
    const realProjects = await client.project.list();
    const template = realProjects[0];
    if (!template) throw new Error("Harness did not seed a project");
    const transport = await startLoopbackServiceProxy(endpoint);
    const target = new URL(transport.url);
    // Only project-list metadata is synthetic. Sessions, forms, loaded locations,
    // SSE, preload, IPC and the attention index all use the real pinned service.
    const projects = [
      ...realProjects,
      ...Array.from({ length: historicalCount }, (_, index) => ({
        ...template,
        id: index.toString(16).padStart(40, "0"),
        name: `Historical project ${index}`,
        canonical: join(coldRoot, String(index)),
        sandboxes: [join(coldRoot, String(index), "old-worktree")],
      })),
    ];
    const requests: string[] = [];
    const pending = new Set<ClientRequest>();
    const heldMetadata = new Set<ServerResponse>();
    let metadataReleased = false;
    let offline = false;
    const releaseMetadata = () => {
      metadataReleased = true;
      for (const response of heldMetadata) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(projects));
      }
      heldMetadata.clear();
    };
    const proxy = createServer((incoming, outgoing) => {
      const path = incoming.url ?? "";
      if (!path.startsWith("/") || path.startsWith("//")) {
        outgoing.writeHead(400).end();
        return;
      }
      requests.push(path);
      if (offline) {
        outgoing.writeHead(503).end();
        return;
      }
      if (incoming.method === "GET" && path.split("?")[0] === "/api/project") {
        heldMetadata.add(outgoing);
        outgoing.on("close", () => heldMetadata.delete(outgoing));
        if (metadataReleased) releaseMetadata();
        return;
      }
      const headers = { ...incoming.headers };
      delete headers.host;
      delete headers.connection;
      const upstream = request(
        { hostname: target.hostname, port: target.port, method: incoming.method, path, headers },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          outgoing.flushHeaders();
          response.on("error", () => outgoing.destroy());
          response.pipe(outgoing);
        },
      );
      pending.add(upstream);
      upstream.on("close", () => pending.delete(upstream));
      upstream.on("error", () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.on("error", () => upstream.destroy());
      outgoing.on("close", () => upstream.destroy());
      incoming.pipe(upstream);
    });
    let profileID: string | undefined;
    let connectionID: string | undefined;
    const originalProfileID = await page.evaluate(
      async () =>
        (await (globalThis as unknown as { palot: PalotApi }).palot.runtimeStatus()).profileID,
    );
    let formID: string | undefined;
    let sessionID: string | undefined;
    let loadedBefore: Awaited<ReturnType<typeof client.debug.location.list>> = [];
    let loadedAfter: typeof loadedBefore = [];
    try {
      await new Promise<void>((resolve, reject) => {
        proxy.once("error", reject);
        proxy.listen(0, "127.0.0.1", () => {
          proxy.off("error", reject);
          resolve();
        });
      });
      const address = proxy.address();
      if (!address || typeof address === "string") throw new Error("Missing fixture proxy port");
      const directory = join(runRoot, "external-idle-location");
      await mkdir(directory, { recursive: true });
      const idle = await client.session.create({
        title: "External idle form owner",
        location: { directory },
      });
      sessionID = idle.id;
      const form = await client.session.form.create({
        sessionID: idle.id,
        title: "External decision without model execution",
        fields: [{ key: "decision", type: "string", title: "Decision", required: true }],
      });
      formID = form.id;
      expect(
        (await client.session.form.get({ sessionID: idle.id, formID: form.id })).state,
      ).toEqual({
        status: "pending",
      });
      // Keep both the idle owner and the harness's selected task outside the
      // newest root page without activating any additional historical locations.
      for (let index = 0; index < 55; index++) {
        await client.session.create({
          title: `Recent metadata fixture ${index}`,
          location: { directory: template.canonical },
        });
      }
      const recent = await client.session.list({ parentID: null, limit: 50, order: "desc" });
      expect(recent.data.some((session) => session.id === idle.id)).toBe(false);
      loadedBefore = await client.debug.location.list();
      expect(loadedBefore.some((location) => location.directory === directory)).toBe(true);
      const connected = await page.evaluate(
        async ({ url, name }) => {
          const api = (globalThis as unknown as { palot: PalotApi }).palot;
          const snapshot = await api.createOpenCodeProfile({
            kind: "remote",
            name,
            urls: [url],
            credential: { type: "none" },
            allowPlainHttp: true,
          });
          const profile = snapshot.profiles.find((entry) => entry.name === name)!;
          const runtime = await api.switchOpenCodeProfile(profile.id);
          return { profileID: profile.id, connectionID: runtime.connectionID };
        },
        { url: `http://127.0.0.1:${address.port}`, name: profileName },
      );
      profileID = connected.profileID;
      connectionID = connected.connectionID;
      // Exercise the real renderer against the held metadata response. The
      // selected task must restore without waiting for project labels.
      const rendererURL = new URL(page.url());
      const route = new URL(rendererURL.hash.slice(1), "http://e2e.invalid");
      route.searchParams.set("profileID", profileID);
      rendererURL.hash = `${route.pathname}${route.search}`;
      await page.goto(rendererURL.href);
      await page.reload();
      await page.getByLabel("Current task").waitFor({ state: "visible", timeout: 10_000 });
      const owner = await page.evaluate(() =>
        (globalThis as unknown as { palot: PalotApi }).palot.runtimeStatus(),
      );
      expect(owner.profileID).toBe(profileID);
      connectionID = owner.connectionID;
      await page.screenshot({ path: join(runRoot, "startup-before-project-labels.png") });
      expect(metadataReleased).toBe(false);
      expect(requests.some((path) => path.split("?")[0] === "/api/project")).toBe(true);
      const snapshot = () =>
        page.evaluate(async (connectionID) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              (globalThis as unknown as { palot: PalotApi }).palot.loadAttentionSnapshot({
                connectionID,
                // No recent roots are supplied: discovery must cover the loaded
                // location, not just active executions or caller-known sessions.
                sessions: [],
              }),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error("Attention blocked on unrelated metadata")),
                  10_000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        }, connectionID!);
      await expect
        .poll(
          async () => {
            const result = await snapshot();
            return {
              complete: result.complete,
              formIDs: result.requests.flatMap((entry) => entry.value.forms.map((form) => form.id)),
              sessionIDs: result.sessions.map((session) => session.id),
            };
          },
          { timeout: 30_000 },
        )
        .toMatchObject({ complete: true, formIDs: [form.id], sessionIDs: [idle.id] });
      expect(metadataReleased).toBe(false);
      // Materialize the metadata response, then repeat discovery to expose the
      // former all-projects scan. This GET itself cannot activate a location.
      releaseMetadata();
      const metadata = await fetch(`http://127.0.0.1:${address.port}/api/project`);
      expect((await metadata.json()).length).toBe(realProjects.length + historicalCount);
      expect((await snapshot()).complete).toBe(true);
      await client.session.form.cancel({ sessionID: idle.id, formID: form.id });
      formID = undefined;
      await expect
        .poll(async () => {
          const result = await snapshot();
          return {
            complete: result.complete,
            forms: result.requests.flatMap((entry) => entry.value.forms),
          };
        })
        .toEqual({ complete: true, forms: [] });

      // A request created while this connection is offline has no live event to
      // replay into its old cache. Reconnect must discover it from loaded state.
      offline = true;
      for (const upstream of pending) upstream.destroy();
      await expect
        .poll(async () =>
          page.evaluate(
            async () =>
              (await (globalThis as unknown as { palot: PalotApi }).palot.runtimeStatus())
                .connected,
          ),
        )
        .toBe(false);
      const offlineForm = await client.session.form.create({
        sessionID: idle.id,
        title: "Decision created while disconnected",
        fields: [{ key: "decision", type: "string", title: "Decision", required: true }],
      });
      formID = offlineForm.id;
      offline = false;
      await expect
        .poll(
          async () =>
            page.evaluate(
              async () =>
                (await (globalThis as unknown as { palot: PalotApi }).palot.runtimeStatus())
                  .connected,
            ),
          { timeout: 30_000 },
        )
        .toBe(true);
      await expect
        .poll(
          async () => {
            const result = await snapshot();
            return {
              complete: result.complete,
              formIDs: result.requests.flatMap((entry) => entry.value.forms.map((form) => form.id)),
            };
          },
          { timeout: 30_000 },
        )
        .toEqual({ complete: true, formIDs: [offlineForm.id] });
      loadedAfter = await client.debug.location.list();
      expect(loadedAfter.filter((location) => location.directory?.startsWith(coldRoot))).toEqual(
        [],
      );
      expect(requests.filter((path) => decodeURIComponent(path).includes(coldRoot))).toEqual([]);
    } finally {
      offline = false;
      releaseMetadata();
      try {
        await writeFile(
          join(runRoot, "startup-attention-counts.json"),
          JSON.stringify(
            {
              fixture:
                "Injected project-list metadata; real isolated service sessions, forms and locations",
              historicalProjectCount: historicalCount,
              requests,
              coldLocationRequests: requests.filter((path) =>
                decodeURIComponent(path).includes(coldRoot),
              ),
              loadedBefore,
              loadedAfter,
            },
            null,
            2,
          ),
        );
        if (sessionID && formID) await client.session.form.cancel({ sessionID, formID });
        if (profileID)
          await page.evaluate(
            async ({ id, original }) => {
              const api = (globalThis as unknown as { palot: PalotApi }).palot;
              if ((await api.runtimeStatus()).profileID === id)
                await api.switchOpenCodeProfile(original);
              await api.disconnectOpenCodeProfile(id);
            },
            { id: profileID, original: originalProfileID },
          );
      } finally {
        for (const upstream of pending) upstream.destroy();
        await new Promise<void>((resolve) => {
          proxy.close(() => resolve());
          proxy.closeAllConnections();
        });
        await transport.close();
      }
    }
  },
};
