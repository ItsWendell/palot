import { Globe2, LockKeyhole, Search } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { resolveBrowserAddress, type BrowserSearchEngine } from "../../lib/browser-address";
import { cn } from "../../lib/cn";
import { Input } from "../ui/input";

export function BrowserAddressBar({
  url,
  searchEngine,
  showFullURL,
  disabled,
  placeholder = "Search or enter a URL",
  autoFocus = false,
  className,
  onNavigate,
  onError,
}: {
  url: string;
  searchEngine: BrowserSearchEngine;
  showFullURL: boolean;
  disabled: boolean;
  placeholder?: string;
  /** Focus the field when it mounts, as a new browser tab does. */
  autoFocus?: boolean;
  className?: string;
  onNavigate(url: string): void;
  onError(message: string): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const editing = draft !== null;
  useLayoutEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  useLayoutEffect(() => {
    if (autoFocus && !disabled) input.current?.focus({ preventScroll: true });
  }, [autoFocus, disabled]);
  const https = url.startsWith("https://");
  const Icon = editing || !url ? Search : https ? LockKeyhole : Globe2;

  return (
    <form
      className={cn("relative min-w-0 flex-1", className)}
      role="search"
      aria-label="Browser navigation"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || !draft?.trim()) return;
        try {
          onNavigate(resolveBrowserAddress(draft, searchEngine));
          input.current?.blur();
        } catch (cause) {
          onError(cause instanceof Error ? cause.message : "Invalid browser address");
        }
      }}
    >
      <span
        className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-muted-foreground"
        title={editing || !url ? placeholder : https ? "HTTPS site" : "Page address"}
      >
        <Icon className="size-3" aria-hidden="true" />
      </span>
      <Input
        ref={input}
        aria-label="Browser address"
        title={url || undefined}
        value={draft ?? (showFullURL ? url : displayBrowserAddress(url))}
        disabled={disabled}
        placeholder={placeholder}
        className="pl-7 text-meta"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={() => setDraft(url)}
        onBlur={() => setDraft(null)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          input.current?.blur();
        }}
      />
    </form>
  );
}

function displayBrowserAddress(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.host : value;
  } catch {
    return value;
  }
}
