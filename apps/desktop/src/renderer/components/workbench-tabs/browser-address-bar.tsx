import { Globe2, LockKeyhole, Search } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { resolveBrowserAddress, type BrowserSearchEngine } from "../../lib/browser-address";
import { Input } from "../ui/input";

export function BrowserAddressBar({
  url,
  searchEngine,
  showFullURL,
  disabled,
  onNavigate,
  onError,
}: {
  url: string;
  searchEngine: BrowserSearchEngine;
  showFullURL: boolean;
  disabled: boolean;
  onNavigate(url: string): void;
  onError(message: string): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const editing = draft !== null;
  useLayoutEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const https = url.startsWith("https://");
  const Icon = editing ? Search : https ? LockKeyhole : Globe2;

  return (
    <form
      className="relative min-w-0 flex-1"
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
        title={editing ? "Search or enter a URL" : https ? "HTTPS site" : "Page address"}
      >
        <Icon className="size-3" aria-hidden="true" />
      </span>
      <Input
        ref={input}
        aria-label="Browser address"
        title={url}
        value={draft ?? (showFullURL ? url : displayBrowserAddress(url))}
        disabled={disabled}
        placeholder="Search or enter a URL"
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
