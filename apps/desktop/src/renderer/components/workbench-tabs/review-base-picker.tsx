import type { LocationRef } from "@opencode/client";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useReviewBase, useVcsBranches } from "../../hooks/use-vcs-info";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "../ui/popover";

export function ReviewBasePicker({
  location,
  active = true,
}: {
  location: LocationRef;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const base = useReviewBase(location, active);
  const branches = useVcsBranches(active && open ? location : null, search);
  const label = base.manual ?? base.inferred.data?.name ?? "Choose base";
  function select(value: string | null) {
    base.setManual(value);
    setOpen(false);
    setSearch("");
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 max-w-full"
            aria-label={`Review base: ${label}`}
          />
        }
      >
        <span className="truncate">Base: {label}</span>
        <ChevronDown aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-1 p-1.5">
        <PopoverHeader className="px-2 py-1">
          <PopoverTitle>Review base</PopoverTitle>
          <PopoverDescription>Compare this branch against a branch or Git ref.</PopoverDescription>
        </PopoverHeader>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          aria-pressed={!base.manual}
          onClick={() => select(null)}
        >
          Use inferred base{!base.manual ? <Check className="ml-auto" aria-hidden="true" /> : null}
        </Button>
        <ReviewBaseStatus base={base} />
        <Input
          aria-label="Search branches or enter a ref"
          placeholder="Search branches or enter a ref"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && search.trim()) {
              event.preventDefault();
              select(search.trim());
            }
          }}
        />
        {search.trim() ? (
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 justify-start"
            onClick={() => select(search.trim())}
          >
            <span className="truncate">Use ref: {search.trim()}</span>
          </Button>
        ) : null}
        {branches.isPending ? (
          <p role="status" className="p-2 text-meta text-muted-foreground">
            Loading branches
          </p>
        ) : null}
        {branches.isError ? (
          <div role="alert" className="p-2 text-meta">
            <p>Could not load branches: {branches.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => void branches.refetch()}>
              Retry branches
            </Button>
          </div>
        ) : null}
        <div className="max-h-64 overflow-y-auto">
          {branches.data?.map((branch) => (
            <Button
              key={branch}
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              aria-pressed={base.manual === branch}
              onClick={() => select(branch)}
            >
              <span className="truncate">{branch}</span>
              {base.manual === branch ? <Check className="ml-auto" aria-hidden="true" /> : null}
            </Button>
          ))}
        </div>
        {branches.isSuccess && branches.data.length === 0 ? (
          <p className="p-2 text-meta text-muted-foreground">
            No matching branches. Enter a ref above.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function ReviewBaseStatus({ base }: { base: ReturnType<typeof useReviewBase> }) {
  if (base.manual) return null;
  if (base.inferred.isError)
    return (
      <div role="alert" className="p-2 text-meta">
        <p>Could not infer a review base: {base.inferred.error.message}</p>
        <Button variant="outline" size="sm" onClick={() => void base.inferred.refetch()}>
          Retry base
        </Button>
      </div>
    );
  return (
    <p role="status" className="p-2 text-meta text-muted-foreground">
      {base.inferred.isPending
        ? "Finding review base…"
        : base.inferred.data
          ? `Inferred: ${base.inferred.data.name} (${base.inferred.data.source})`
          : "No unambiguous base found. Choose a branch or enter a ref."}
    </p>
  );
}
