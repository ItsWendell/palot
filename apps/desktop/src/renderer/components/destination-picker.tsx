import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { Cloud, Monitor } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { PalotProject } from "../../shared";
import { disabledProfileIDsAtom } from "../atoms/connections";
import { runtimeAtom } from "../atoms/workspace";
import { connectionOverview } from "../lib/connection-overview";
import {
  destinationGroups,
  destinationKey,
  type NewTaskDestination,
} from "../lib/new-task-destination";
import { projectName } from "../lib/view-models";
import { connectionDescription } from "./connection-badge";
import { ComposerPicker, type ComposerPickerSection } from "./ui/composer-picker";

/** A destination is one project on one device, never a project ID alone. */
export function DestinationPicker({
  value,
  projects = [],
  onChange,
  onChat,
}: {
  value: NewTaskDestination;
  projects?: PalotProject[];
  onChange?(destination: NewTaskDestination): void;
  onChat?(): void;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const disabled = useAtomValue(disabledProfileIDsAtom);
  const controller = connectionOverview(useQueryClient());
  const connections = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const groups = destinationGroups(connections, runtime?.profileID, projects);
  const selected = groups.find((entry) => entry.profile.id === value.profileID);
  const project = selected?.projects.find((entry) => entry.id === value.projectID);
  const offline =
    value.profileID === runtime?.profileID ? !runtime.connected : !selected?.runtime?.connected;
  type Destination = NewTaskDestination | "chat";
  const sections: ComposerPickerSection<Destination>[] = groups.map((entry) => {
    const isDisabled = disabled.includes(entry.profile.id);
    const connected =
      entry.profile.id === runtime?.profileID ? runtime.connected : entry.runtime?.connected;
    const status = isDisabled ? "Disabled" : connected ? "" : "Offline";
    const description = connectionDescription(entry.profile);
    const rows: (PalotProject | null)[] = entry.projects.length ? entry.projects : [null];
    return {
      key: entry.profile.id,
      heading: `${entry.profile.name} · ${description}`,
      options: rows.map((item) => ({
        key: destinationKey(entry.profile.id, item),
        value: { profileID: entry.profile.id, projectID: item?.id ?? null },
        label: item ? projectName(item) : "Choose server",
        // The section heading names the server; rows carry the path and its state.
        description: item?.canonical,
        badges: status ? [{ label: status, tone: "warning" as const }] : undefined,
        keywords: [entry.profile.name, description, item?.canonical],
        disabled: isDisabled || !onChange,
      })),
    };
  });
  if (onChat)
    sections.unshift({
      key: "chat",
      options: [
        {
          key: "chat",
          value: "chat",
          label: "No project — just chat",
          description: "Start a chat on the current server",
        },
      ],
    });

  return (
    <ComposerPicker<Destination>
      size="context"
      triggerRole="combobox"
      label={project ? projectName(project) : "Choose destination"}
      ariaLabel="Task destination"
      icon={
        selected?.profile.kind === "local" ? (
          <Monitor aria-hidden="true" />
        ) : (
          <Cloud aria-hidden="true" />
        )
      }
      secondary={selected?.profile.name ?? value.profileID}
      status={disabled.includes(value.profileID) ? "Disabled" : offline ? "Offline" : null}
      labelClassName="max-w-48"
      triggerProps={{ title: project?.canonical }}
      side="bottom"
      popupClassName="w-96 max-w-[calc(100vw-2rem)]"
      listLabel="Destinations"
      search={{
        label: "Search destinations",
        placeholder: "Search projects, paths, or servers…",
      }}
      sections={sections}
      selectedKey={destinationKey(value.profileID, project ?? null)}
      emptyLabel="No destinations found"
      errorTitle="Could not change the destination"
      onSelect={(option) => (option.value === "chat" ? onChat?.() : onChange?.(option.value))}
    />
  );
}
