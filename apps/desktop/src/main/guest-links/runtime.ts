import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import Store from "electron-store";
import * as v from "valibot";
import { GUEST_LINKS_IPC_CHANNELS } from "../../shared/guest-links-contract";
import { openCodeRuntime } from "../opencode-runtime";
import { GuestLinksServer, type GuestSource } from "./server";
import { guestRows } from "./projection";
import { GuestPublisher } from "./publisher";
import { openCodeLog } from "../opencode-observability";

let server: GuestLinksServer | undefined;
let settings: Store<{ enabled: boolean }> | undefined;
const publisher = new GuestPublisher();
let publishing = false;
let transports: { tailscale: boolean; opentunnel: boolean } | undefined;
function service() {
  if (server) return server;
  settings = new Store<{ enabled: boolean }>({ name: "guest-links", defaults: { enabled: false } });
  server = new GuestLinksServer(() => {
    if (!server?.state().shares.length && !publishing)
      void publisher
        .stop()
        .catch((error) => openCodeLog.warn("Guest route cleanup failed", { error: String(error) }));
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed())
        window.webContents.send(GUEST_LINKS_IPC_CHANNELS.guestLinksChanged);
    }
  });
  void server.enable(settings.get("enabled"));
  return server;
}

const id = v.pipe(v.string(), v.minLength(1), v.maxLength(512));
const commandSchema = v.variant("type", [
  v.strictObject({ type: v.literal("state") }),
  v.strictObject({ type: v.literal("enable"), enabled: v.boolean() }),
  v.strictObject({
    type: v.literal("create"),
    connectionID: id,
    sessionID: id,
    hours: v.nullable(v.picklist([1, 24, 168])),
  }),
  v.strictObject({ type: v.literal("revoke"), shareID: id }),
  v.strictObject({ type: v.literal("approve"), messageID: id }),
  v.strictObject({ type: v.literal("dismiss"), messageID: id }),
  v.strictObject({ type: v.literal("publish-options") }),
  v.strictObject({
    type: v.literal("publish"),
    shareID: id,
    transport: v.picklist(["tailscale", "opentunnel"]),
    confirmed: v.literal(true),
  }),
]);

function source(connectionID: string, sessionID: string): GuestSource {
  const connection = openCodeRuntime.scopedConnection(connectionID);
  return {
    snapshot: () =>
      connection.withClient(async (client) => {
        const options = { signal: AbortSignal.timeout(10000) };
        const [session, messages, active] = await Promise.all([
          client.session.get({ sessionID }, options),
          client.message.list({ sessionID, limit: 100 }, options),
          client.session.active(options),
        ]);
        if (session.time.archived) throw new Error("Archived tasks cannot be shared");
        return {
          title: (session.title ?? "Untitled task").slice(0, 500),
          status: active[sessionID] ? "working" : "idle",
          rows: guestRows(messages.data),
        };
      }),
    subscribe(changed, revoked) {
      const disposers = [
        connection.onDispose(revoked),
        connection.onReconnect(changed),
        openCodeRuntime.onRuntimeStatus((status) => {
          if (status.connectionID === connectionID) changed();
        }),
        connection.onEvent((event) => {
          if (!("sessionID" in event.data) || event.data.sessionID !== sessionID) return;
          if (event.type === "session.deleted" || event.type === "session.archived") revoked();
          else changed();
        }),
      ];
      return () => disposers.forEach((dispose) => dispose());
    },
    send: (text, id) =>
      connection.withClient(async (client) => {
        const session = await client.session.get(
          { sessionID },
          { signal: AbortSignal.timeout(10000) },
        );
        if (session.time.archived) throw new Error("Task is archived");
        await client.session.prompt(
          { sessionID, id, text },
          { signal: AbortSignal.timeout(15000) },
        );
      }),
  };
}

export function registerGuestLinksIpc(
  register: (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ) => void,
) {
  register(GUEST_LINKS_IPC_CHANNELS.guestLinksCommand, async (_event, input) => {
    const command = v.parse(commandSchema, input);
    const host = service();
    if (command.type === "enable") {
      await host.enable(command.enabled);
      settings!.set("enabled", command.enabled);
    }
    if (command.type === "create")
      await host.create(command, command.hours, source(command.connectionID, command.sessionID));
    if (command.type === "revoke") await host.revoke(command.shareID);
    if (command.type === "approve" || command.type === "dismiss")
      await host.decide(command.messageID, command.type === "approve");
    if (command.type === "publish-options") transports = await publisher.options();
    if (command.type === "publish") {
      if (publishing) throw new Error("A guest link is already being published");
      const share = host.state().shares.find((share) => share.id === command.shareID);
      if (!share) throw new Error("Guest link ended");
      publishing = true;
      try {
        host.published(share.id, await publisher.publish(share.localUrl, command.transport));
      } finally {
        publishing = false;
        if (!host.state().shares.length) await publisher.stop();
      }
    }
    if (!host.state().shares.length && !publishing) await publisher.stop();
    return { ...host.state(), transports };
  });
}

export async function shutdownGuestLinks() {
  await server?.enable(false);
  await publisher
    .stop()
    .catch((error) => openCodeLog.warn("Guest route cleanup failed", { error: String(error) }));
}
