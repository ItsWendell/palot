import { expect } from "@playwright/test";
import { rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PalotApi, PalotAttachmentProgress } from "../../src/shared/opencode-contract";
import type { Scenario } from "./scenarios";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);

export const remoteAttachmentsScenario: Scenario = {
  description:
    "Remote-profile streamed native upload, progress/cancellation IPC, service bytes, and safe preview grants",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run() {},
  async assert(page, { client, session, llm }) {
    const initial = await page.evaluate(async () => {
      const api = (globalThis as unknown as { palot: PalotApi }).palot;
      const profiles = await api.listOpenCodeProfiles();
      const pairing = await api.openCodePairingInfo();
      const loopback = pairing.urls.find((value) =>
        ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname),
      );
      if (!loopback) throw new Error("Isolated service has no loopback pairing address");
      const before = new Set(profiles.profiles.map((profile) => profile.id));
      // Pair only with the harness-owned service. Credentials never leave this evaluation.
      const created = await api.createOpenCodeProfile({
        kind: "remote",
        name: "Remote attachments fixture",
        urls: [loopback],
        credential: { type: "basic", username: pairing.username, password: pairing.password },
        allowPlainHttp: true,
      });
      const profile = created.profiles.find((entry) => !before.has(entry.id));
      if (!profile) throw new Error("Remote attachment profile was not created");
      return { originalID: profiles.activeProfileID, profileID: profile.id };
    });

    let uploadedPath: string | undefined;
    try {
      await page.evaluate(async (profileID) => {
        const api = (globalThis as unknown as { palot: PalotApi }).palot;
        const key = "palot.desktop.state.onboarding.completed-profiles";
        const completed = JSON.parse(localStorage.getItem(key) ?? '{"version":1,"value":{}}');
        localStorage.setItem(
          key,
          JSON.stringify({ version: 1, value: { ...completed.value, [profileID]: 1 } }),
        );
        await api.switchOpenCodeProfile(profileID);
      }, initial.profileID);
      await page.reload();
      await page.evaluate((id) => {
        window.location.hash = `/sessions/${id}`;
      }, session.id);
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const api = (globalThis as unknown as { palot: PalotApi }).palot;
            const status = await api.runtimeStatus();
            return {
              connected: status.connected,
              profileID: status.profileID,
              topology: status.topology,
              localFileAttachments: status.capabilities?.localFileAttachments,
            };
          }),
        )
        .toEqual({
          connected: true,
          profileID: initial.profileID,
          topology: "remote-machine",
          localFileAttachments: true,
        });
      await expect(page.getByRole("textbox", { name: "Message Palot", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Attach files", exact: true })).toBeEnabled();

      const result = await page.evaluate(
        async (bytes) => {
          const api = (globalThis as unknown as { palot: PalotApi }).palot;
          const { connectionID } = await api.runtimeStatus();
          if (!connectionID) throw new Error("Remote attachment connection is missing");
          const requestID = crypto.randomUUID();
          const progress: PalotAttachmentProgress[] = [];
          const unsubscribe = api.onAttachmentProgress((value) => {
            if (value.requestID === requestID) progress.push(value);
          });
          try {
            const selected = await api.attachClipboardImages(
              [{ mime: "image/png", data: Uint8Array.from(bytes).buffer }],
              connectionID,
              requestID,
            );
            return { selected, connectionID, progress, requestID };
          } finally {
            unsubscribe();
          }
        },
        [...png],
      );
      expect(result.selected.errors).toEqual([]);
      expect(result.selected.files).toHaveLength(1);
      const attachment = result.selected.files[0]!;
      expect(attachment.mime).toBe("image/png");
      expect(attachment.size).toBe(png.length);
      expect(attachment.previewGrant).toBeTruthy();
      expect(result.progress.length).toBeGreaterThan(0);
      expect(result.progress.at(-1)).toMatchObject({
        requestID: result.requestID,
        connectionID: result.connectionID,
        name: attachment.name,
        loaded: png.length,
        total: png.length,
        count: 1,
      });
      const remotePath = fileURLToPath(attachment.uri);
      const server = await client.server.info();
      expect(dirname(remotePath)).toBe(server.paths.tmp);
      uploadedPath = remotePath;
      expect(
        Buffer.from(
          await client.file.read({
            location: { directory: server.paths.tmp },
            path: basename(remotePath),
          }),
        ),
      ).toEqual(png);

      const preview = await page.evaluate(
        async ({ attachment, connectionID }) => {
          const api = (globalThis as unknown as { palot: PalotApi }).palot;
          const image = await api.attachmentPreview(attachment.previewGrant!, connectionID);
          let rejectedRawURI = false;
          try {
            await api.attachmentPreview(attachment.uri, connectionID);
          } catch {
            rejectedRawURI = true;
          }
          return {
            mime: image?.mime,
            bytes: image ? Array.from(new Uint8Array(image.data)) : null,
            rejectedRawURI,
          };
        },
        { attachment, connectionID: result.connectionID },
      );
      expect(preview).toEqual({ mime: "image/png", bytes: [...png], rejectedRawURI: true });

      const cancelled = await page.evaluate(
        async (bytes) => {
          const api = (globalThis as unknown as { palot: PalotApi }).palot;
          const { connectionID } = await api.runtimeStatus();
          const requestID = crypto.randomUUID();
          const pending = api
            .attachClipboardImages(
              [{ mime: "image/png", data: Uint8Array.from(bytes).buffer }],
              connectionID,
              requestID,
            )
            .then(
              () => false,
              () => true,
            );
          await api.cancelAttachmentUpload(requestID);
          return pending;
        },
        [...png],
      );
      expect(cancelled).toBe(true);
    } finally {
      // This profile targets the harness-owned loopback service on this machine.
      if (uploadedPath) await rm(uploadedPath, { force: true });
      await page.evaluate(async ({ originalID, profileID }) => {
        const api = (globalThis as unknown as { palot: PalotApi }).palot;
        try {
          await api.switchOpenCodeProfile(originalID);
        } finally {
          await api.deleteOpenCodeProfile(profileID);
        }
      }, initial);
    }
    expect(llm.requests).toHaveLength(0);
  },
};
