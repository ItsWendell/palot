import { Bot, FileText, FolderSymlink, Sparkles, TerminalSquare } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { cn } from "../lib/cn";
import { SurfaceBackdrop } from "./ui/surface-backdrop";

export type ComposerDiscoveryItem =
  | {
      kind: "command";
      key: string;
      name: string;
      description: string | null;
      detail: string | null;
    }
  | {
      kind: "skill";
      key: string;
      id: string;
      name: string;
      description: string | null;
    }
  | {
      kind: "file";
      key: string;
      path: string;
      name: string;
    }
  | {
      kind: "agent";
      key: string;
      /** Agent ID, which OpenCode prompt agent parts name. */
      name: string;
      description: string | null;
    }
  | {
      kind: "reference";
      key: string;
      name: string;
      /** Absolute directory OpenCode resolved for the reference. */
      path: string;
      description: string | null;
    };

const GROUP_LABELS: Record<ComposerDiscoveryItem["kind"], string> = {
  command: "Commands",
  skill: "Skills",
  file: "Files",
  agent: "Agents",
  reference: "References",
};

/** Runs of consecutive same-kind items, keeping each item's index in the full list. */
function groupItems(items: ComposerDiscoveryItem[]) {
  const groups: {
    kind: ComposerDiscoveryItem["kind"];
    items: [ComposerDiscoveryItem, number][];
  }[] = [];
  items.forEach((item, index) => {
    const last = groups.at(-1);
    if (last?.kind === item.kind) last.items.push([item, index]);
    else groups.push({ kind: item.kind, items: [[item, index]] });
  });
  return groups;
}

export function ComposerDiscovery({
  id,
  items,
  activeIndex,
  loading,
  error,
  onActiveIndexChange,
  onSelect,
}: {
  id: string;
  items: ComposerDiscoveryItem[];
  activeIndex: number;
  loading: boolean;
  error: string | null;
  onActiveIndexChange(index: number): void;
  onSelect(item: ComposerDiscoveryItem): void;
}) {
  const groups = groupItems(items);
  // A single kind needs no heading; `@` mixes references, agents, and files.
  const labelled = groups.length > 1;
  return (
    <div
      id={id}
      className="palot-translucent-popover absolute right-0 bottom-[calc(100%+8px)] left-0 isolate z-30 overflow-hidden rounded-xl border border-foreground/12 p-1 shadow-xl"
      role="listbox"
      aria-label="Composer suggestions"
    >
      <SurfaceBackdrop />
      <div className="max-h-80 overflow-y-auto overscroll-contain py-0.5">
        {groups.map((group, groupIndex) => {
          const options = group.items.map(([item, index]) => (
            <DiscoveryOption
              key={item.key}
              id={`${id}-option-${index}`}
              item={item}
              active={index === activeIndex}
              onActive={() => onActiveIndexChange(index)}
              onSelect={() => onSelect(item)}
            />
          ));
          if (!labelled) return <Fragment key={`${group.kind}:${groupIndex}`}>{options}</Fragment>;
          const labelID = `${id}-group-${groupIndex}`;
          return (
            <div key={`${group.kind}:${groupIndex}`} role="group" aria-labelledby={labelID}>
              <div
                id={labelID}
                className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground"
              >
                {GROUP_LABELS[group.kind]}
              </div>
              {options}
            </div>
          );
        })}
        {loading ? (
          <div className="px-3 py-3 text-xs text-muted-foreground" role="status">
            Searching...
          </div>
        ) : null}
        {!loading && error ? (
          <div className="px-3 py-3 text-xs text-destructive" role="alert">
            {error}
          </div>
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">No matches found.</div>
        ) : null}
      </div>
    </div>
  );
}

function DiscoveryOption({
  id,
  item,
  active,
  onActive,
  onSelect,
}: {
  id: string;
  item: ComposerDiscoveryItem;
  active: boolean;
  onActive(): void;
  onSelect(): void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none",
        active ? "bg-muted text-foreground" : "hover:bg-muted/65",
      )}
      onMouseEnter={onActive}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {item.kind === "command" ? (
          <TerminalSquare className="size-3.5" aria-hidden="true" />
        ) : item.kind === "skill" ? (
          <Sparkles className="size-3.5" aria-hidden="true" />
        ) : item.kind === "agent" ? (
          <Bot className="size-3.5" aria-hidden="true" />
        ) : item.kind === "reference" ? (
          <FolderSymlink className="size-3.5" aria-hidden="true" />
        ) : (
          <FileText className="size-3.5" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium">
            {item.kind === "command"
              ? `/${item.name}`
              : item.kind === "skill"
                ? `$${item.id}`
                : `@${item.name}`}
          </span>
          {item.kind === "command" && item.detail ? (
            <span className="truncate text-meta text-muted-foreground">{item.detail}</span>
          ) : null}
          {item.kind === "skill" && item.name !== item.id ? (
            <span className="truncate text-meta text-muted-foreground">{item.name}</span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {item.kind === "file"
            ? item.path
            : item.kind === "reference"
              ? (item.description ?? item.path)
              : item.kind === "agent"
                ? (item.description ?? "Subagent")
                : (item.description ?? "No description")}
        </span>
      </span>
    </button>
  );
}
