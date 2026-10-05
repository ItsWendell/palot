import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { Check, ChevronDown, Cloud, CloudOff, Monitor } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { disabledProfileIDsAtom } from "../atoms/connections";
import { runtimeAtom } from "../atoms/workspace";
import { connectionOverview } from "../lib/connection-overview";
import { ConnectionBadge, connectionDescription } from "./connection-badge";
import { Button } from "./ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import type { PalotProject } from "../../shared";
import type { NewTaskDestination } from "../lib/new-task-destination";
import { DestinationPicker } from "./destination-picker";

/** Keep the execution owner visible without subscribing the composer to background tasks. */
export function ConnectionDestination({
  onProfileChange,
  destination,
  projects,
  onDestinationChange,
}: {
  onProfileChange?(profileID: string): void;
  destination?: NewTaskDestination;
  projects?: PalotProject[];
  onDestinationChange?(destination: NewTaskDestination): void;
} = {}) {
  if (destination)
    return (
      <DestinationPicker value={destination} projects={projects} onChange={onDestinationChange} />
    );
  return <ConnectionContext onProfileChange={onProfileChange} />;
}

function ConnectionContext({ onProfileChange }: { onProfileChange?(profileID: string): void }) {
  const runtime = useAtomValue(runtimeAtom);
  const controller = connectionOverview(useQueryClient());
  const select = useCallback(() => {
    return controller.getSnapshot().find((entry) => entry.profile.id === runtime?.profileID)
      ?.profile;
  }, [controller, runtime?.profileID]);
  const profile = useSyncExternalStore(controller.subscribe, select, select);
  if (onProfileChange) return <ConnectionSelector onProfileChange={onProfileChange} />;
  if (!profile || (profile.kind === "local" && runtime?.connected)) return null;
  if (!runtime?.connected) {
    return (
      <span
        role="status"
        title={`${connectionDescription(profile)} · Reconnect to send messages`}
        className="inline-flex h-6 min-w-0 max-w-full items-center gap-1 px-1.5 text-meta text-warning"
      >
        <CloudOff className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="max-w-40 truncate">{profile.name}</span>
        <span className="shrink-0"> · Offline</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 min-w-0 items-center px-1.5"
      aria-label={`Execution connection: ${profile.name}`}
    >
      <ConnectionBadge profile={profile} connected />
    </span>
  );
}

/** Drafts can change execution owners; existing sessions must keep theirs. */
function ConnectionSelector({ onProfileChange }: { onProfileChange(profileID: string): void }) {
  const runtime = useAtomValue(runtimeAtom);
  const disabled = useAtomValue(disabledProfileIDsAtom);
  const controller = connectionOverview(useQueryClient());
  const connections = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [open, setOpen] = useState(false);
  const profile = connections.find((entry) => entry.profile.id === runtime?.profileID)?.profile;
  if (!profile) return null;
  if (connections.length === 1 && profile.kind === "local" && runtime?.connected) return null;
  const Icon = !runtime?.connected ? CloudOff : profile.kind === "local" ? Monitor : Cloud;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="context"
            role="combobox"
            aria-label={`Server: ${profile.name}`}
            aria-expanded={open}
            title={connectionDescription(profile)}
          />
        }
      >
        <Icon
          className={runtime?.connected && profile.kind !== "local" ? "text-success" : undefined}
          aria-hidden="true"
        />
        <span className="max-w-40 truncate">{profile.name}</span>
        {!runtime?.connected ? <span className="text-warning">Offline</span> : null}
        <ChevronDown aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-1">
        <Command label="Search servers" className="bg-transparent p-0">
          <CommandInput placeholder="Search servers…" aria-label="Search servers" autoFocus />
          <CommandList className="max-h-72">
            <CommandEmpty>No servers found</CommandEmpty>
            <CommandGroup heading="Run this task on">
              {connections.map((entry) => {
                const isDisabled = disabled.includes(entry.profile.id);
                const EntryIcon = entry.profile.kind === "local" ? Monitor : Cloud;
                return (
                  <CommandItem
                    key={entry.profile.id}
                    value={`${connectionDescription(entry.profile)} ${entry.profile.id}`}
                    disabled={isDisabled}
                    onSelect={() => {
                      onProfileChange(entry.profile.id);
                      setOpen(false);
                    }}
                  >
                    <EntryIcon aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{entry.profile.name}</span>
                      <span className="block truncate text-meta text-muted-foreground">
                        {connectionDescription(entry.profile)}
                        {isDisabled ? " · Disabled" : !entry.runtime?.connected ? " · Offline" : ""}
                      </span>
                    </span>
                    {entry.profile.id === runtime?.profileID ? <Check aria-hidden="true" /> : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
