import type { MachineInfo, MachineInvite } from "@opencode/client";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { CircleCheck, Network, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { disabledProfileIDsAtom } from "../../atoms/connections";
import { useConnectionOverview } from "../../hooks/use-connection-overview";
import type { ConnectionOverview } from "../../lib/connection-overview";
import { openCodeKeys } from "../../lib/opencode-query";
import {
  inviteAddresses,
  inviteExpiryLabel,
  inviteReachSummary,
  isMachineConflict,
  machineErrorMessage,
  machineJoined,
  machineNameProblem,
  machineReach,
  machineRows,
  machinesUnavailable,
  type MachineRow,
} from "../../lib/opencode-machines";
import { canFetchOpenCode } from "../../lib/opencode-runtime-query";
import { showErrorToast } from "../../lib/toast-error";
import { openCodeClient } from "../../services/opencode-client";
import { useArmedConfirm } from "../pull-requests/use-armed-confirm";
import {
  SettingsEmpty,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
} from "../settings-layout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CopyField } from "../ui/copy-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

/** How often the list refreshes while the page is open: online state has no event. */
export const MACHINE_LIST_REFRESH_MS = 15_000;
/** How often the add dialog checks whether its machine joined. */
export const MACHINE_JOIN_POLL_MS = 2_000;

export const machineKeys = {
  list: (connectionID: string) => [...openCodeKeys.all(connectionID), "machines"] as const,
};

type ListData = readonly MachineInfo[] | "unavailable";

async function listMachines(connectionID: string, signal?: AbortSignal): Promise<ListData> {
  try {
    return await openCodeClient(connectionID).experimental.machine.list({ signal });
  } catch (error) {
    if (machinesUnavailable(error)) return "unavailable";
    throw error;
  }
}

interface MachineServer {
  connectionID: string;
  name: string;
}

function connectedServers(
  connections: readonly ConnectionOverview[],
  disabled: readonly string[],
): MachineServer[] {
  return connections.flatMap((entry) =>
    entry.runtime && !disabled.includes(entry.profile.id) && canFetchOpenCode(entry.runtime)
      ? [{ connectionID: entry.runtime.connectionID, name: entry.profile.name }]
      : [],
  );
}

/**
 * OpenCode's experimental machines, one section per connected server that has them turned on.
 * A server without the `machines` flag (or older than machines) shows no section.
 */
export function MachinesSettings() {
  const { connections } = useConnectionOverview();
  const disabled = useAtomValue(disabledProfileIDsAtom);
  const servers = connectedServers(connections, disabled);
  const lists = useQueries({
    queries: servers.map((server) => ({
      queryKey: machineKeys.list(server.connectionID),
      queryFn: ({ signal }: { signal: AbortSignal }) => listMachines(server.connectionID, signal),
      refetchInterval: MACHINE_LIST_REFRESH_MS,
      retry: false,
    })),
  });
  const settled = lists.every((list) => !list.isPending);
  const available = servers.filter((_, index) => {
    const data = lists[index]?.data;
    return lists[index]?.isError || (data !== undefined && data !== "unavailable");
  });

  if (servers.length === 0) {
    return (
      <SettingsSection title="Machines" icon={Network}>
        <SettingsGroup>
          <SettingsEmpty>Connect to an OpenCode server to manage its machines.</SettingsEmpty>
        </SettingsGroup>
      </SettingsSection>
    );
  }
  if (available.length === 0) {
    if (!settled) return null;
    return <MachinesOff />;
  }
  return (
    <>
      {available.map((server) => (
        <ServerMachines key={server.connectionID} server={server} title={server.name} />
      ))}
    </>
  );
}

function MachinesOff() {
  return (
    <SettingsSection title="Machines" icon={Network}>
      <SettingsGroup>
        <SettingsEmpty>
          None of your connected servers has machines turned on. They're an experimental OpenCode
          feature: set <code className="text-code-compact">experimental.machines</code> to{" "}
          <code className="text-code-compact">true</code> in the server's OpenCode config, or start
          it with <code className="text-code-compact">OPENCODE_FLAGS=machines</code>, then
          reconnect.
        </SettingsEmpty>
      </SettingsGroup>
    </SettingsSection>
  );
}

export function ServerMachines({ server, title }: { server: MachineServer; title: string }) {
  const query = useQuery({
    queryKey: machineKeys.list(server.connectionID),
    queryFn: ({ signal }) => listMachines(server.connectionID, signal),
    refetchInterval: MACHINE_LIST_REFRESH_MS,
    retry: false,
  });
  const [adding, setAdding] = useState(false);
  const machines = Array.isArray(query.data) ? query.data : [];
  const rows = machineRows(machines);
  return (
    <SettingsSection
      title={title}
      icon={Network}
      description="Machines this server's tasks can reach."
      action={
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAdding(true)}
          aria-label={`Add machine to ${server.name}`}
        >
          <Plus aria-hidden="true" />
          Add machine
        </Button>
      }
    >
      {query.isError ? (
        <SettingsNotice status="error" title="Couldn't load machines">
          {machineErrorMessage(query.error)}
        </SettingsNotice>
      ) : null}
      <SettingsGroup>
        {rows.length === 0 ? (
          <SettingsEmpty>
            {query.isPending
              ? "Loading machines…"
              : "No machines yet. Add one to let tasks on this server read, edit and run commands on another computer, by naming it in a path such as devbox:/srv/app."}
          </SettingsEmpty>
        ) : (
          rows.map((row) => (
            <MachineSettingsRow key={row.name} row={row} connectionID={server.connectionID} />
          ))
        )}
      </SettingsGroup>
      <AddMachineDialog
        open={adding}
        onOpenChange={setAdding}
        connectionID={server.connectionID}
        serverName={server.name}
      />
    </SettingsSection>
  );
}

function stateBadge(row: MachineRow) {
  return (
    <Badge
      variant={
        row.state === "connected" ? "success" : row.state === "waiting" ? "warning" : "neutral"
      }
    >
      {row.stateLabel}
    </Badge>
  );
}

function MachineSettingsRow({ row, connectionID }: { row: MachineRow; connectionID: string }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const remove = useArmedConfirm(() => {
    setPending(true);
    void openCodeClient(connectionID)
      .experimental.machine.remove({ name: row.name })
      .then(() => queryClient.invalidateQueries({ queryKey: machineKeys.list(connectionID) }))
      .catch((error: unknown) =>
        showErrorToast(
          `Couldn't remove ${row.name}`,
          new Error(machineErrorMessage(error, row.name)),
        ),
      )
      .finally(() => setPending(false));
  });
  const details = [row.platform, row.link].filter(Boolean).join(" · ");
  return (
    <SettingsRow
      title={<span className="font-mono">{row.name}</span>}
      badge={stateBadge(row)}
      description={
        details ||
        (row.state === "waiting"
          ? "Added, but no computer has joined with its join string yet."
          : row.state === "offline"
            ? "Paired. It shows its system and link once it connects again."
            : undefined)
      }
      control={
        <Button
          type="button"
          variant={remove.armed ? "destructive" : "ghost"}
          size={remove.armed ? "sm" : "icon-sm"}
          disabled={pending}
          aria-label={remove.armed ? `Confirm remove ${row.name}` : `Remove ${row.name}`}
          title={remove.armed ? undefined : "Remove machine"}
          {...remove.buttonProps}
        >
          <Trash2 aria-hidden="true" />
          {remove.armed ? "Remove?" : null}
        </Button>
      }
    />
  );
}

type AddState =
  | { phase: "name" }
  | { phase: "adding" }
  | { phase: "conflict"; message: string }
  | { phase: "invite"; invite: MachineInvite };

/**
 * Names a machine, makes its single-use join string, then waits for it to connect: the list is
 * polled while the dialog is open because OpenCode has no machine event.
 */
export function AddMachineDialog({
  open,
  onOpenChange,
  connectionID,
  serverName,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  connectionID: string;
  serverName: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [state, setState] = useState<AddState>({ phase: "name" });
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const inputID = useId();
  const problem = machineNameProblem(name.trim());
  const inviteName = state.phase === "invite" ? state.invite.name : null;

  const joined = useQuery({
    queryKey: [...machineKeys.list(connectionID), "join", inviteName],
    queryFn: async ({ signal }) => {
      const list = await listMachines(connectionID, signal);
      return list !== "unavailable" && inviteName !== null && machineJoined(list, inviteName);
    },
    enabled: open && inviteName !== null,
    refetchInterval: (query) => (query.state.data ? false : MACHINE_JOIN_POLL_MS),
    retry: false,
  });
  const connected = joined.data === true;

  useEffect(() => {
    if (connected) void queryClient.invalidateQueries({ queryKey: machineKeys.list(connectionID) });
  }, [connected, connectionID, queryClient]);

  const reset = () => {
    setName("");
    setState({ phase: "name" });
    setError(null);
    setTouched(false);
  };

  const add = async (replace = false) => {
    const target = name.trim();
    setTouched(true);
    if (machineNameProblem(target)) return;
    setError(null);
    setState({ phase: "adding" });
    try {
      const client = openCodeClient(connectionID);
      const urls = await client.server
        .info()
        .then((info) => info.urls)
        .catch(() => [] as string[]);
      const invite = await client.experimental.machine.add({
        name: target,
        reach: machineReach(urls),
        ...(replace ? { replace: true } : {}),
      });
      setState({ phase: "invite", invite });
      void queryClient.invalidateQueries({ queryKey: machineKeys.list(connectionID) });
    } catch (cause) {
      const message = machineErrorMessage(cause, target);
      if (isMachineConflict(cause)) setState({ phase: "conflict", message });
      else {
        setState({ phase: "name" });
        setError(message);
      }
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void add();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {state.phase === "invite" ? `Join ${state.invite.name}` : "Add machine"}
          </DialogTitle>
          <DialogDescription>
            {state.phase === "invite"
              ? `A computer that joins with this string links to ${serverName}. Tasks there can then name it in paths, such as ${state.invite.name}:/srv/app.`
              : `Name another computer for ${serverName}. You get a single-use join string for it.`}
          </DialogDescription>
        </DialogHeader>
        {state.phase === "invite" ? (
          <InviteDetails invite={state.invite} connected={connected} />
        ) : (
          <form id={`${inputID}-form`} onSubmit={submit} className="flex flex-col gap-1.5">
            <label htmlFor={inputID} className="text-meta text-muted-foreground">
              Machine name
            </label>
            <Input
              id={inputID}
              autoFocus
              value={name}
              placeholder="devbox"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-invalid={touched && problem !== null ? true : undefined}
              aria-describedby={`${inputID}-hint`}
              disabled={state.phase === "adding"}
              onChange={(event) => {
                setName(event.target.value);
                if (state.phase === "conflict") setState({ phase: "name" });
              }}
            />
            <p
              id={`${inputID}-hint`}
              className={
                touched && problem
                  ? "text-meta text-destructive"
                  : "text-meta text-muted-foreground"
              }
            >
              {touched && problem
                ? problem
                : "Lowercase letters, digits and hyphens. Tasks use it in paths."}
            </p>
            {error ? (
              <p role="alert" className="text-meta text-destructive">
                {error}
              </p>
            ) : null}
            {state.phase === "conflict" ? (
              <SettingsNotice
                status="warning"
                title="Already paired"
                actions={
                  <Button type="button" size="sm" variant="outline" onClick={() => void add(true)}>
                    Replace key
                  </Button>
                }
              >
                {state.message}
              </SettingsNotice>
            ) : null}
          </form>
        )}
        <DialogFooter>
          {state.phase === "invite" ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {connected ? "Done" : "Close"}
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                form={`${inputID}-form`}
                disabled={state.phase === "adding" || state.phase === "conflict"}
              >
                {state.phase === "adding" ? <Spinner aria-hidden="true" /> : null}
                Add machine
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function InviteDetails({ invite, connected }: { invite: MachineInvite; connected: boolean }) {
  const now = useNow(15_000);
  const expiry = inviteExpiryLabel(invite.expires, now);
  const addresses = inviteAddresses(invite.reach);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <CopyField
        label="Join string"
        valueName="join string"
        value={invite.join}
        secret
        disabled={connected}
      />
      <p className="text-meta text-muted-foreground">
        {connected ? "Used." : `Single use. ${expiry}.`} {inviteReachSummary(invite.reach)}
      </p>
      {addresses.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-meta text-muted-foreground">Addresses in this string</span>
          <ul className="flex min-w-0 flex-col gap-0.5">
            {addresses.map((address) => (
              <li key={address} className="truncate font-mono text-code-compact" title={address}>
                {address}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {connected ? null : (
        <SettingsNotice status="info" title="Run the worker on that computer">
          The computer joins by running OpenCode's machine worker with this string. OpenCode 2.4.1
          ships no worker command yet, so there's nothing to run there today; add the machine again
          for a fresh string once a release has one.
        </SettingsNotice>
      )}
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm">
        {connected ? (
          <>
            <CircleCheck className="size-4 text-success" aria-hidden="true" />
            <span>{invite.name} is connected</span>
          </>
        ) : expiry === "Expired" ? (
          <span className="text-muted-foreground">
            This join string expired. Close and add {invite.name} again for a new one.
          </span>
        ) : (
          <>
            <Spinner className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground">Waiting for {invite.name} to connect…</span>
          </>
        )}
      </div>
    </div>
  );
}
