import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Ellipsis,
  Globe2,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { browserSearchEngineAtom, remoteMarkdownFaviconsAtom } from "../../atoms/ui";
import { browserRecentSiteLabel, type BrowserRecentSite } from "../../lib/browser-recent-sites";
import { cn } from "../../lib/cn";
import { useShortcutKeys, type KeyboardShortcutID } from "../../lib/keyboard-shortcuts";
import { duckDuckGoFaviconUrl } from "../../lib/markdown-favicon";
import { SidebarFluidList, sidebarFluidRowProps } from "../sidebar-fluid-list";
import { BrowserAddressBar } from "../workbench-tabs/browser-address-bar";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { ShortcutKbd } from "../ui/kbd";

export interface NewTabTool {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Shown with its effective binding; omitted when the surface has no shortcut. */
  shortcut?: KeyboardShortcutID;
  /** Hover text, for example what the tool opens. */
  description?: string;
  onSelect(): void;
}

export interface NewTabBrowser {
  /** The experimental browser is turned on in Settings. */
  enabled: boolean;
  /** Opens the address in this tab. Resolves once the page is placed. */
  navigate(url: string): Promise<void> | void;
}

/**
 * The New tab page: a browser tab with nothing loaded yet. The address field sits centred
 * in the toolbar; below it, tools turn this tab into another workbench surface and
 * suggested sites reopen pages from the task browser.
 */
export function NewTabPage({
  browser,
  tools,
  moreTools = [],
  suggestions = [],
  onClearSuggestions,
  onAskSideQuestion,
  autoFocus = false,
}: {
  browser: NewTabBrowser;
  tools: NewTabTool[];
  moreTools?: NewTabTool[];
  suggestions?: BrowserRecentSite[];
  onClearSuggestions?: () => void;
  /** Asks a `/btw` side question; the Side chat tool reveals its field when set. */
  onAskSideQuestion?: (question: string) => Promise<void> | void;
  autoFocus?: boolean;
}) {
  const searchEngine = useAtomValue(browserSearchEngineAtom);
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const moreID = useId();
  const navigate = (url: string) => {
    setError(null);
    void new Promise<void>((resolve) => resolve(browser.navigate(url))).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not open the page"),
    );
  };
  const visibleTools = tools.map((tool) =>
    tool.id === "side-chat" && onAskSideQuestion
      ? { ...tool, onSelect: () => setAsking((current) => !current) }
      : tool,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-new-tab-page="">
      {/* Side columns never shrink below their buttons but share leftover space equally, so
          the address field stays centred whenever the pane has room. */}
      <div className="grid h-9 shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,32rem)_minmax(max-content,1fr)] items-center gap-1 border-b border-border bg-background px-2">
        <div className="flex items-center gap-1">
          <Button type="button" size="icon-xs" variant="ghost" disabled aria-label="Browser back">
            <ArrowLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled
            aria-label="Browser forward"
          >
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" disabled aria-label="Reload page">
            <RotateCw aria-hidden="true" />
          </Button>
        </div>
        <BrowserAddressBar
          url=""
          searchEngine={searchEngine}
          showFullURL
          disabled={!browser.enabled}
          placeholder={browser.enabled ? "Search or enter a URL" : "Turn on the browser to browse"}
          autoFocus={autoFocus && browser.enabled}
          className="w-full"
          onNavigate={navigate}
          onError={setError}
        />
        <div className="flex min-w-0 justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" size="icon-xs" variant="ghost" aria-label="Browser options" />
              }
            >
              <Ellipsis aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onClick={() => {
                  window.location.hash = "#/settings/browser";
                }}
              >
                Browser settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {error ? (
        <p
          role="alert"
          className="border-b border-destructive/40 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
          <NewTabSection title="Tools">
            <NewTabGrid label="Tools">
              {visibleTools.map((tool) => (
                <NewTabToolTile
                  key={tool.id}
                  tool={tool}
                  expanded={tool.id === "side-chat" && onAskSideQuestion ? asking : undefined}
                />
              ))}
              {moreTools.length ? (
                <button
                  type="button"
                  {...sidebarFluidRowProps}
                  className={tileClass}
                  aria-expanded={moreOpen}
                  aria-controls={moreID}
                  onClick={() => setMoreOpen((current) => !current)}
                >
                  <ChevronDown
                    className={cn("size-4 shrink-0 transition-transform", moreOpen && "rotate-180")}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">More tools…</span>
                </button>
              ) : null}
            </NewTabGrid>
            {asking && onAskSideQuestion ? (
              <SideQuestionForm onAsk={onAskSideQuestion} onCancel={() => setAsking(false)} />
            ) : null}
            {moreOpen && moreTools.length ? (
              <div id={moreID}>
                <NewTabGrid label="More tools">
                  {moreTools.map((tool) => (
                    <NewTabToolTile key={tool.id} tool={tool} />
                  ))}
                </NewTabGrid>
              </div>
            ) : null}
          </NewTabSection>
          {suggestions.length ? (
            <NewTabSection
              title="Suggested"
              action={
                onClearSuggestions ? (
                  <Button type="button" size="xs" variant="ghost" onClick={onClearSuggestions}>
                    Clear
                  </Button>
                ) : null
              }
            >
              <NewTabGrid label="Suggested sites">
                {suggestions.map((site) => (
                  <SuggestedSiteTile
                    key={site.url}
                    site={site}
                    disabled={!browser.enabled}
                    onOpen={() => navigate(site.url)}
                  />
                ))}
              </NewTabGrid>
            </NewTabSection>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const tileClass =
  "flex h-9 min-w-0 items-center gap-2 rounded-md border border-border/60 px-2.5 text-left text-sm text-foreground/90 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:text-muted-foreground";

function NewTabSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex h-6 items-center justify-between gap-2">
        <h2 id={id} className="text-meta font-medium text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Arrow keys move between tiles in reading order, rows by the rendered column count. */
function NewTabGrid({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key) || event.altKey || event.metaKey || event.ctrlKey) return;
    const tiles = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    const index = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const firstTop = tiles[0]?.offsetTop;
    const columns = Math.max(1, tiles.filter((tile) => tile.offsetTop === firstTop).length);
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tiles.length - 1
          : event.key === "ArrowLeft"
            ? index - 1
            : event.key === "ArrowRight"
              ? index + 1
              : event.key === "ArrowUp"
                ? index - columns
                : index + columns;
    const tile = tiles[target];
    if (!tile) return;
    event.preventDefault();
    tile.focus();
  };
  return (
    <div ref={ref} role="group" aria-label={label} onKeyDown={onKeyDown}>
      <SidebarFluidList
        axis="xy"
        highlightClassName="bg-(--control-hover)"
        className="grid grid-cols-1 gap-1.5 @min-[20rem]/workbench:grid-cols-2"
      >
        {children}
      </SidebarFluidList>
    </div>
  );
}

function NewTabToolTile({ tool, expanded }: { tool: NewTabTool; expanded?: boolean }) {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      {...sidebarFluidRowProps}
      className={tileClass}
      title={tool.description}
      aria-expanded={expanded}
      onClick={tool.onSelect}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{tool.label}</span>
      {tool.shortcut ? <ToolShortcut id={tool.shortcut} /> : null}
    </button>
  );
}

function ToolShortcut({ id }: { id: KeyboardShortcutID }) {
  const keys = useShortcutKeys(id);
  if (!keys.length) return null;
  // Two-column tiles only have room for key chips in a wider workbench; the label wins.
  return (
    <ShortcutKbd
      keys={keys}
      className="ml-auto hidden shrink-0 @min-[32rem]/workbench:inline-flex"
    />
  );
}

function SuggestedSiteTile({
  site,
  disabled,
  onOpen,
}: {
  site: BrowserRecentSite;
  disabled: boolean;
  onOpen(): void;
}) {
  const label = browserRecentSiteLabel(site);
  return (
    <button
      type="button"
      {...sidebarFluidRowProps}
      className={tileClass}
      title={site.url}
      disabled={disabled}
      onClick={onOpen}
    >
      <SiteIcon url={site.url} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function SiteIcon({ url }: { url: string }) {
  const remote = useAtomValue(remoteMarkdownFaviconsAtom);
  const favicon = remote ? duckDuckGoFaviconUrl(url) : null;
  const [failed, setFailed] = useState(false);
  if (!favicon || failed) return <Globe2 className="size-4 shrink-0" aria-hidden="true" />;
  return (
    <img
      src={favicon}
      alt=""
      className="size-4 shrink-0 rounded-xs"
      decoding="async"
      loading="lazy"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

function SideQuestionForm({
  onAsk,
  onCancel,
}: {
  onAsk(question: string): Promise<void> | void;
  onCancel(): void;
}) {
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      aria-label="Side question"
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!question.trim() || pending) return;
        setPending(true);
        setError(null);
        void new Promise<void>((resolve) => resolve(onAsk(question.trim())))
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "Could not ask the question"),
          )
          .finally(() => setPending(false));
      }}
    >
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          aria-label="Ask a side question"
          placeholder="Ask a side question…"
          value={question}
          className="min-w-0 flex-1"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }}
        />
        <Button type="submit" size="sm" disabled={!question.trim() || pending}>
          Ask
        </Button>
      </div>
      <p className="text-meta text-muted-foreground">
        Answered beside the task. Not added to the conversation.
      </p>
      {error ? (
        <p role="alert" className="text-meta text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
