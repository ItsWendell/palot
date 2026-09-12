import { File as CodeFile, type SelectedLineRange } from "@pierre/diffs/react";
import { FileCode2, FolderOpen, RefreshCw, SquareArrowOutUpRight } from "lucide-react";
import { useMemo, useRef } from "react";
import { useAtomValue } from "jotai";
import { resolvedAppearanceAtom } from "../../atoms/appearance";
import { runtimeAtom } from "../../atoms/workspace";
import { useWorkspaceFile } from "../../hooks/use-workspace-file";
import { cn } from "../../lib/cn";
import { contentCacheKey } from "../../lib/file-diffs";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { pierreViewerStyle, pierreViewerTheme } from "../file-viewer-theme";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";

export function FileTab({ tab }: { tab: Extract<WorkbenchTab, { kind: "file" }> }) {
  const runtime = useAtomValue(runtimeAtom);
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const query = useWorkspaceFile(tab.resource.location, tab.resource.path);
  const decoded = useMemo(() => decodeFile(query.data), [query.data]);
  const selectedLines = useMemo<SelectedLineRange | null>(
    () => (tab.resource.line ? { start: tab.resource.line, end: tab.resource.line } : null),
    [tab.resource.line],
  );
  const scrolledTarget = useRef<string | null>(null);
  const text = decoded && "text" in decoded ? decoded.text : "";
  const file = useMemo(
    () => ({
      name: tab.resource.path,
      contents: text,
      cacheKey: contentCacheKey(tab.resource.path, text),
    }),
    [tab.resource.path, text],
  );
  const options = useMemo(
    () => ({
      ...pierreViewerTheme,
      theme: appearance.codeThemePair,
      themeType: appearance.scheme,
      onPostRender(node: HTMLElement) {
        const line = tab.resource.line;
        if (!line) return;
        const targetKey = `${tab.resource.path}:${line}`;
        if (scrolledTarget.current === targetKey) return;
        const root = node.shadowRoot ?? node;
        const target = root.querySelector<HTMLElement>(`[data-line="${line}"]`);
        if (!target) return;
        scrolledTarget.current = targetKey;
        target.scrollIntoView({ block: "center" });
      },
    }),
    [appearance.codeThemePair, appearance.scheme, tab.resource.line, tab.resource.path],
  );

  const fullPath =
    tab.resource.path.startsWith("/") || tab.resource.path.startsWith("~")
      ? tab.resource.path
      : `${tab.resource.location.directory.replace(/\/+$/, "")}/${tab.resource.path}`;
  const fileHref = `file://${encodeURI(fullPath)}${tab.resource.line ? `#L${tab.resource.line}` : ""}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
        <FileCode2 className="size-3 text-muted-foreground" aria-hidden="true" />
        <a
          href={fileHref}
          className="min-w-0 flex-1 truncate text-meta hover:underline"
          title={tab.resource.path}
          onClick={(event) => event.preventDefault()}
        >
          {tab.resource.path}
          {tab.resource.line ? `:${tab.resource.line}` : ""}
        </a>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Open in editor"
          title="Open in editor"
          disabled={
            runtime?.profileID !== tab.resource.profileID ||
            runtime?.capabilities?.localPathActions !== true
          }
          onClick={() => {
            void palot.externalOpen(
              {
                resource: {
                  kind: "file",
                  path: fullPath,
                  line: tab.resource.line,
                },
              },
              runtime?.connectionID,
            );
          }}
        >
          <SquareArrowOutUpRight className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Reveal in Finder"
          title="Reveal in Finder"
          disabled={
            runtime?.profileID !== tab.resource.profileID ||
            runtime?.capabilities?.localPathActions !== true
          }
          onClick={() => {
            void palot.revealFileInFinder(fullPath, runtime?.connectionID);
          }}
        >
          <FolderOpen className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh file"
          onClick={() => void query.refetch()}
        >
          <RefreshCw className={cn(query.isFetching && "animate-spin")} aria-hidden="true" />
        </Button>
      </div>
      {query.isPending ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Spinner /> Loading file
        </div>
      ) : query.isError ? (
        <Empty className="rounded-none p-5">
          <EmptyHeader>
            <EmptyTitle>Could not load file</EmptyTitle>
            <EmptyDescription>{query.error.message}</EmptyDescription>
          </EmptyHeader>
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RefreshCw data-icon="inline-start" /> Retry
          </Button>
        </Empty>
      ) : decoded?.binary ? (
        <Empty className="rounded-none p-5">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileCode2 aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Preview unavailable</EmptyTitle>
            <EmptyDescription>{tab.resource.path} is not a UTF-8 text file.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="palot-native-scrollbar min-h-0 flex-1 overflow-auto bg-[var(--code-background)]">
          <CodeFile
            file={file}
            selectedLines={selectedLines}
            options={options}
            style={pierreViewerStyle}
            className="min-w-full"
          />
        </div>
      )}
    </div>
  );
}

function decodeFile(
  data: Uint8Array | undefined,
): { text: string; binary: false } | { binary: true } | null {
  if (!data) return null;
  if (data.subarray(0, 8_192).includes(0)) return { binary: true };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(data), binary: false };
  } catch {
    return { binary: true };
  }
}
