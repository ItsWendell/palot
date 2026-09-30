import type { Browser } from "@opencode/plugin-browser/rpc";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Ellipsis,
  ExternalLink,
  Globe2,
  RotateCw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PalotBrowserUserCommand } from "../../../shared/browser-contract";
import { browserViewportsAtom, type BrowserViewport } from "../browser-webview-hosts";
import { useBrowserReconnect, useBrowserSession } from "../../hooks/use-browser-session";
import { browserSearchEngineAtom, browserShowFullURLAtom } from "../../atoms/ui";
import { runtimeAtom } from "../../atoms/workspace";
import { isLocalBrowserURL, resolveBrowserAddress } from "../../lib/browser-address";
import type { WorkbenchScope } from "../../lib/workbench-tabs";
import { workbenchScopeKey } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export function BrowserTab({
  scope,
  tabID,
  active,
}: {
  scope: WorkbenchScope;
  tabID: string;
  active: boolean;
}) {
  const pageID = tabID as Browser.TabID;
  const browser = useBrowserSession(scope);
  const reconnect = useBrowserReconnect(scope);
  const bindingID = browser?.bindingID;
  const page = browser?.state.tabs.find((tab) => tab.id === tabID);
  const popup = browser?.popupTabIDs.includes(pageID);
  const focused = browser?.state.focusedTabID === tabID;
  const searchEngine = useAtomValue(browserSearchEngineAtom);
  const showFullURL = useAtomValue(browserShowFullURLAtom);
  const runtime = useAtomValue(runtimeAtom);
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [zoom, setZoom] = useState(100);
  const viewport = useRef<HTMLDivElement>(null);
  const setViewports = useSetAtom(browserViewportsAtom);
  const scopeKey = workbenchScopeKey(scope);
  const layoutPage = useRef({ bindingID, tabID: pageID });

  useEffect(() => {
    if (!editing) setAddress(page?.url ?? "");
  }, [editing, page?.url, page?.id]);

  useLayoutEffect(() => {
    if (!bindingID || !page) return;
    layoutPage.current = { bindingID, tabID: pageID };
    const element = viewport.current;
    let frame = 0;
    let published: BrowserViewport | undefined;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element?.getBoundingClientRect();
        const visible = Boolean(
          active && focused && element?.isConnected && rect && rect.width > 0 && rect.height > 0,
        );
        published = {
          bindingID,
          tabID: pageID,
          visible,
          ...(element?.isConnected && rect && rect.width > 0 && rect.height > 0
            ? {
                bounds: {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                },
              }
            : {}),
        };
        setViewports((current) => {
          if (visible) return { ...current, [scopeKey]: published! };
          if (current[scopeKey]?.bindingID !== bindingID || current[scopeKey]?.tabID !== tabID)
            return current;
          const next = { ...current };
          delete next[scopeKey];
          return next;
        });
        void palot
          .browserLayout({
            bindingID,
            tabID: pageID,
            visible,
            ...(visible && rect
              ? {
                  bounds: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                  },
                }
              : {}),
          })
          .catch((cause: unknown) => {
            if (visible)
              setError(cause instanceof Error ? cause.message : "Could not display browser page");
          });
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (element) observer.observe(element);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [bindingID, Boolean(page), tabID, active, focused, scopeKey, setViewports]);

  // Inventory/title changes restart observation, but must not hide the active
  // guest or release its keyboard focus. Only unmount/owner changes tear down.
  useLayoutEffect(
    () => () => {
      if (!bindingID) return;
      setViewports((current) => {
        if (current[scopeKey]?.bindingID !== bindingID || current[scopeKey]?.tabID !== tabID)
          return current;
        const next = { ...current };
        delete next[scopeKey];
        return next;
      });
      if (layoutPage.current.bindingID !== bindingID || layoutPage.current.tabID !== tabID) return;
      void palot.browserLayout({ bindingID, tabID: pageID, visible: false }).catch(() => undefined);
    },
    [bindingID, tabID, scopeKey, setViewports],
  );

  const command = async (action: PalotBrowserUserCommand) => {
    if (!bindingID) return;
    try {
      setError(null);
      await palot.browserCommand(bindingID, action);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Browser command failed");
    }
  };

  const control = async (action: Parameters<typeof palot.browserPageControl>[2]) => {
    if (!bindingID) return;
    try {
      setError(null);
      const value = await palot.browserPageControl(bindingID, pageID, action);
      if (typeof value === "number") setZoom(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Browser page control failed");
    }
  };

  useEffect(() => {
    if (active && findOpen) return;
    if (findOpen) setFindOpen(false);
    if (bindingID && findQuery)
      void palot
        .browserPageControl(bindingID, pageID, { type: "find.stop" })
        .catch(() => undefined);
  }, [active, bindingID, findOpen, findQuery, pageID]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" inert={!active}>
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!page?.canGoBack}
          aria-label="Browser back"
          onClick={() => page && void command({ type: "back", tabID: pageID })}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!page?.canGoForward}
          aria-label="Browser forward"
          onClick={() => page && void command({ type: "forward", tabID: pageID })}
        >
          <ArrowRight aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!page}
          aria-label={page?.loading ? "Stop loading" : "Reload page"}
          onClick={() =>
            page && void command({ type: page.loading ? "stop" : "reload", tabID: pageID })
          }
        >
          {page?.loading ? <X aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
        </Button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!page || !address.trim()) return;
            try {
              const url = resolveBrowserAddress(address, searchEngine);
              void command({ type: "navigate", tabID: pageID, url });
              setEditing(false);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Invalid browser address");
            }
          }}
        >
          <Input
            aria-label="Browser address"
            value={editing || showFullURL ? address : displayURL(address)}
            disabled={!page}
            placeholder="Search or enter a URL"
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onChange={(event) => setAddress(event.target.value)}
          />
        </form>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Browser options" />
            }
          >
            <Ellipsis aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem disabled={!page} onClick={() => setFindOpen(true)}>
              <Search /> Find in page
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!page?.url}
              onClick={() => {
                if (!page?.url) return;
                void navigator.clipboard
                  .writeText(page.url)
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : "Could not copy URL"),
                  );
              }}
            >
              <Copy /> Copy page URL
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!page || !/^https?:\/\//i.test(page.url)}
              onClick={() => {
                if (!page) return;
                const url = new URL(page.url);
                if (isLocalBrowserURL(url) && runtime?.topology !== "same-machine") {
                  setError(
                    "This address belongs to the task's server. A desktop browser would open localhost on this computer instead.",
                  );
                  return;
                }
                void palot
                  .openExternalUrl(page.url)
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : "Could not open URL"),
                  );
              }}
            >
              <ExternalLink /> Open in desktop browser
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!page}
              onClick={() => void control({ type: "zoom", direction: -1 })}
            >
              <ZoomOut /> Zoom out
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!page}
              onClick={() => void control({ type: "zoom", direction: 0 })}
            >
              Reset zoom ({zoom}%)
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!page}
              onClick={() => void control({ type: "zoom", direction: 1 })}
            >
              <ZoomIn /> Zoom in
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
      {findOpen ? (
        <form
          className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1"
          onSubmit={(event) => {
            event.preventDefault();
            void control({ type: "find", query: findQuery, next: true });
          }}
        >
          <Input
            autoFocus
            aria-label="Find in page"
            placeholder="Find in page"
            value={findQuery}
            className="min-w-0 flex-1"
            onChange={(event) => {
              setFindQuery(event.target.value);
              void control({ type: "find", query: event.target.value });
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setFindOpen(false);
                void control({ type: "find.stop" });
              } else if (event.key === "Enter" && event.shiftKey) {
                event.preventDefault();
                void control({ type: "find", query: findQuery, forward: false, next: true });
              }
            }}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Close find"
            onClick={() => {
              setFindOpen(false);
              void control({ type: "find.stop" });
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </form>
      ) : null}
      {browser?.error || error || page?.loadError ? (
        <div className="flex items-center gap-2 border-b border-destructive/40 px-3 py-2">
          <p role="alert" className="min-w-0 flex-1 text-sm text-destructive">
            {browser?.error || error || page?.loadError}
          </p>
          {browser?.error && !bindingID ? (
            <Button type="button" size="sm" variant="outline" onClick={reconnect}>
              Reconnect browser
            </Button>
          ) : null}
        </div>
      ) : null}
      <div ref={viewport} data-slot="browser-viewport" className="relative min-h-0 flex-1">
        {popup ? (
          <Empty className="size-full">
            <EmptyHeader>
              <EmptyTitle>Open in a separate browser window</EmptyTitle>
            </EmptyHeader>
            <Button
              type="button"
              variant="outline"
              onClick={() => void command({ type: "tabs.focus", tabID: pageID })}
            >
              Focus popup window
            </Button>
          </Empty>
        ) : !page ? (
          <Empty className="size-full">
            <EmptyHeader>
              <Globe2 className="mx-auto size-5" aria-hidden="true" />
              <EmptyTitle>Browser</EmptyTitle>
              <EmptyDescription>
                {browser?.error
                  ? "Browser is unavailable on this connection."
                  : bindingID
                    ? "Open a tab to get started."
                    : "Connecting to the browser plugin…"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : active && !focused ? (
          <Empty className="size-full">
            <EmptyHeader>
              <EmptyTitle>Browser page is focused in another pane</EmptyTitle>
              <EmptyDescription>Only one page per task can be visible at a time.</EmptyDescription>
            </EmptyHeader>
            <Button
              type="button"
              variant="outline"
              onClick={() => void command({ type: "tabs.focus", tabID: pageID })}
            >
              Show this page
            </Button>
          </Empty>
        ) : null}
      </div>
    </div>
  );
}

function displayURL(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : value;
  } catch {
    return value;
  }
}
