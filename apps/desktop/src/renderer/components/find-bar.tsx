import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { IconButton } from "./ui";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { SurfaceBackdrop } from "./ui/surface-backdrop";

/**
 * The focused element, looking into open shadow roots, so closing find can return focus
 * to an editor inside a code view rather than to its host.
 */
export function deepActiveElement(): HTMLElement | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/** "3 of 12", "No results" while settled, or nothing before a search. */
export function findStatus({
  searching,
  matchCount,
  activeIndex,
  truncated,
  pending,
}: {
  searching: boolean;
  matchCount: number;
  activeIndex: number;
  truncated: boolean;
  pending: boolean;
}): string {
  if (!searching) return "";
  if (matchCount === 0) return pending ? "" : "No results";
  return `${activeIndex + 1} of ${truncated ? `${matchCount}+` : matchCount}`;
}

/**
 * The floating find bar shared by Find in task, Find in diff and Find in file: Enter and
 * Shift+Enter step through matches, Escape closes.
 */
export function FindBar({
  label,
  shortcut,
  query,
  status,
  matchCount,
  inputRef,
  unavailable,
  onQueryChange,
  onStep,
  onClose,
  children,
}: {
  /** Names the search landmark and its field, such as "Find in task". */
  label: string;
  /** `aria-keyshortcuts` for the field. */
  shortcut: string;
  query: string;
  status: string;
  matchCount: number;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Shown instead of searching when the surface has no searchable text. */
  unavailable?: string;
  onQueryChange(query: string): void;
  onStep(direction: "next" | "previous"): void;
  onClose(): void;
  /** Footer rows below the field. */
  children?: ReactNode;
}) {
  return (
    <div
      role="search"
      aria-label={label}
      className="palot-translucent-popover absolute top-2 right-4 z-30 isolate flex w-80 max-w-[calc(100%-2rem)] flex-col rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      <SurfaceBackdrop />
      <div className="flex items-center gap-0.5 p-1">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon aria-hidden="true">
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            type="text"
            value={query}
            placeholder={label}
            aria-label={label}
            aria-keyshortcuts={shortcut}
            // Read-only, not disabled, so the field still takes focus and Escape.
            readOnly={unavailable !== undefined}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
                return;
              }
              if (event.key === "Enter" && !event.altKey && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                onStep(event.shiftKey ? "previous" : "next");
              }
            }}
          />
          {status ? (
            <InputGroupAddon align="inline-end" className="tabular-nums" aria-hidden="true">
              {status}
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <IconButton
          label="Previous match"
          icon={ChevronUp}
          size="icon-sm"
          disabled={matchCount === 0}
          onClick={() => onStep("previous")}
        />
        <IconButton
          label="Next match"
          icon={ChevronDown}
          size="icon-sm"
          disabled={matchCount === 0}
          onClick={() => onStep("next")}
        />
        <IconButton label="Close find" icon={X} size="icon-sm" onClick={onClose} />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {unavailable ?? status}
      </span>
      {unavailable ? (
        <p
          aria-hidden="true"
          className="border-t border-foreground/10 px-2.5 py-1 text-meta text-muted-foreground"
        >
          {unavailable}
        </p>
      ) : null}
      {children}
    </div>
  );
}
