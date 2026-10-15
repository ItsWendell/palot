import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import {
  Building2,
  CircleCheck,
  CircleDot,
  FileDiff,
  FolderGit2,
  ListFilter,
  Plus,
  X,
} from "lucide-react";
import { useState } from "react";
import type { PullRequestSearchPage } from "../../../shared/source-control-contract";
import { sourceControlKeys } from "../../hooks/use-source-control";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  activePullRequestFilterCount,
  EMPTY_PULL_REQUEST_FILTERS,
  MAX_SCOPE_FILTERS,
  normalizeOwner,
  normalizeRepository,
  pullRequestFiltersAtom,
  type PullRequestChecksFilter,
  type PullRequestFilters,
  type PullRequestReviewFilter,
} from "./pull-request-preferences";

const REVIEW_LABELS: Record<PullRequestReviewFilter, string> = {
  required: "Needs review",
  approved: "Approved",
  changes_requested: "Changes requested",
};
const CHECKS_LABELS: Record<PullRequestChecksFilter, string> = {
  success: "Passing",
  failure: "Failing",
  pending: "Pending",
};

/** Repositories seen in any loaded pull request list, for filter suggestions. */
function knownRepositories(queryClient: QueryClient): string[] {
  const repositories = new Set<string>();
  for (const [, data] of queryClient.getQueriesData<{ pages: PullRequestSearchPage[] }>({
    queryKey: sourceControlKeys.searches(),
  }))
    for (const page of data?.pages ?? [])
      for (const item of page.items) repositories.add(item.repository);
  return [...repositories];
}

function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value].slice(-MAX_SCOPE_FILTERS);
}

/** Header button: add repository, organization, review, checks, and draft filters. */
export function PullRequestFilterMenu() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useAtom(pullRequestFiltersAtom);
  const [known, setKnown] = useState<string[]>([]);
  const activeCount = activePullRequestFilterCount(filters);
  const update = (patch: Partial<PullRequestFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));
  const repositories = [...new Set([...filters.repositories, ...known])].toSorted();
  const owners = [
    ...new Set([
      ...filters.organizations,
      ...repositories.map((repository) => repository.split("/")[0]!),
    ]),
  ].toSorted();

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setKnown(knownRepositories(queryClient));
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="window-no-drag relative"
            aria-label={
              activeCount ? `Filter pull requests, ${activeCount} active` : "Filter pull requests"
            }
          />
        }
      >
        <ListFilter aria-hidden="true" />
        {activeCount > 0 ? (
          <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-info ring-1 ring-background" />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5 text-xs font-normal text-muted-foreground">
            Filter every list…
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="min-h-9">
            <FolderGit2 aria-hidden="true" />
            <span>Repository</span>
            <FilterCount count={filters.repositories.length} />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-80 p-1">
            <ScopePicker
              label="repositories"
              placeholder="Search or add owner/name…"
              options={repositories}
              selected={filters.repositories}
              normalize={normalizeRepository}
              onToggle={(value) => update({ repositories: toggle(filters.repositories, value) })}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="min-h-9">
            <Building2 aria-hidden="true" />
            <span>Organization</span>
            <FilterCount count={filters.organizations.length} />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64 p-1">
            <ScopePicker
              label="organizations"
              placeholder="Search or add an owner…"
              options={owners}
              selected={filters.organizations}
              normalize={normalizeOwner}
              onToggle={(value) => update({ organizations: toggle(filters.organizations, value) })}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="min-h-9">
            <CircleDot aria-hidden="true" />
            <span>Review</span>
            {filters.review ? <FilterValue>{REVIEW_LABELS[filters.review]}</FilterValue> : null}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48 p-1">
            <DropdownMenuRadioGroup
              value={filters.review ?? "any"}
              onValueChange={(value) =>
                update({ review: value === "any" ? null : (value as PullRequestReviewFilter) })
              }
            >
              <DropdownMenuRadioItem value="any" closeOnClick={false}>
                Any
              </DropdownMenuRadioItem>
              {(Object.keys(REVIEW_LABELS) as PullRequestReviewFilter[]).map((value) => (
                <DropdownMenuRadioItem key={value} value={value} closeOnClick={false}>
                  {REVIEW_LABELS[value]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="min-h-9">
            <CircleCheck aria-hidden="true" />
            <span>Checks</span>
            {filters.checks ? <FilterValue>{CHECKS_LABELS[filters.checks]}</FilterValue> : null}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44 p-1">
            <DropdownMenuRadioGroup
              value={filters.checks ?? "any"}
              onValueChange={(value) =>
                update({ checks: value === "any" ? null : (value as PullRequestChecksFilter) })
              }
            >
              <DropdownMenuRadioItem value="any" closeOnClick={false}>
                Any
              </DropdownMenuRadioItem>
              {(Object.keys(CHECKS_LABELS) as PullRequestChecksFilter[]).map((value) => (
                <DropdownMenuRadioItem key={value} value={value} closeOnClick={false}>
                  {CHECKS_LABELS[value]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuCheckboxItem
          className="min-h-9"
          checked={filters.hideDrafts}
          closeOnClick={false}
          onCheckedChange={(hideDrafts) => update({ hideDrafts })}
        >
          <FileDiff aria-hidden="true" />
          Hide drafts
        </DropdownMenuCheckboxItem>
        {activeCount > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-muted-foreground"
              onClick={() => setFilters(EMPTY_PULL_REQUEST_FILTERS)}
            >
              Clear filters
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterCount({ count }: { count: number }) {
  return count > 0 ? (
    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{count}</span>
  ) : null;
}

function FilterValue({ children }: { children: string }) {
  return (
    <span className="ml-auto max-w-24 truncate text-xs text-muted-foreground">{children}</span>
  );
}

/** Multi-select over suggestions; a valid typed name that is not listed can be added. */
function ScopePicker({
  label,
  placeholder,
  options,
  selected,
  normalize,
  onToggle,
}: {
  label: string;
  placeholder: string;
  options: readonly string[];
  selected: readonly string[];
  normalize(value: string): string | null;
  onToggle(value: string): void;
}) {
  const [search, setSearch] = useState("");
  const typed = normalize(search);
  const addable = typed !== null && !options.includes(typed) ? typed : null;
  const ordered = [
    ...options.filter((option) => selected.includes(option)),
    ...options.filter((option) => !selected.includes(option)),
  ];
  return (
    <Command className="bg-transparent p-0">
      <CommandInput
        placeholder={placeholder}
        aria-label={`Search ${label}`}
        value={search}
        onValueChange={setSearch}
        autoFocus
      />
      <CommandList className="max-h-72">
        <CommandEmpty>
          {search ? "Type a full name to add it" : `No ${label} seen yet. Type one to add it.`}
        </CommandEmpty>
        <CommandGroup>
          {addable ? (
            <CommandItem
              value={`add ${addable}`}
              onSelect={() => {
                onToggle(addable);
                setSearch("");
              }}
            >
              <Plus aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">Add {addable}</span>
            </CommandItem>
          ) : null}
          {ordered.map((option) => (
            <CommandItem
              key={option}
              value={option}
              data-checked={selected.includes(option) || undefined}
              onSelect={() => onToggle(option)}
            >
              <span className="min-w-0 flex-1 truncate">{option}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/** Active filters as removable chips under the search field. */
export function PullRequestFilterChips({ className }: { className?: string }) {
  const [filters, setFilters] = useAtom(pullRequestFiltersAtom);
  const chips: Array<{ key: string; label: string; remove(): void }> = [
    ...filters.repositories.map((repository) => ({
      key: `repo:${repository}`,
      label: repository,
      remove: () =>
        setFilters((current) => ({
          ...current,
          repositories: current.repositories.filter((entry) => entry !== repository),
        })),
    })),
    ...filters.organizations.map((owner) => ({
      key: `org:${owner}`,
      label: `${owner}/*`,
      remove: () =>
        setFilters((current) => ({
          ...current,
          organizations: current.organizations.filter((entry) => entry !== owner),
        })),
    })),
    ...(filters.review
      ? [
          {
            key: "review",
            label: REVIEW_LABELS[filters.review],
            remove: () => setFilters((current) => ({ ...current, review: null })),
          },
        ]
      : []),
    ...(filters.checks
      ? [
          {
            key: "checks",
            label: `Checks ${CHECKS_LABELS[filters.checks].toLowerCase()}`,
            remove: () => setFilters((current) => ({ ...current, checks: null })),
          },
        ]
      : []),
    ...(filters.hideDrafts
      ? [
          {
            key: "drafts",
            label: "No drafts",
            remove: () => setFilters((current) => ({ ...current, hideDrafts: false })),
          },
        ]
      : []),
  ];
  if (chips.length === 0) return null;
  return (
    <ul
      aria-label="Active filters"
      className={cn("flex shrink-0 flex-wrap items-center gap-1 px-3 pb-2", className)}
    >
      {chips.map((chip) => (
        <li
          key={chip.key}
          className="flex h-6 max-w-full min-w-0 items-center gap-0.5 rounded-md border border-border/70 bg-muted/40 pr-0.5 pl-2 text-micro text-foreground/85"
        >
          <span className="min-w-0 truncate">{chip.label}</span>
          <button
            type="button"
            aria-label={`Remove filter ${chip.label}`}
            className="flex size-4.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={chip.remove}
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </li>
      ))}
      {chips.length > 1 ? (
        <li>
          <button
            type="button"
            className="h-6 rounded-md px-1.5 text-micro text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setFilters(EMPTY_PULL_REQUEST_FILTERS)}
          >
            Clear
          </button>
        </li>
      ) : null}
    </ul>
  );
}
