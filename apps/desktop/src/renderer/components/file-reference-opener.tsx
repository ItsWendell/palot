/** Opens transcript file references in the workbench after resolving them on the server. */

import { isFileNotFoundError, type LocationRef } from "@opencode/client";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { FileCode2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { PalotMessage } from "../../shared";
import { workspaceFileQueryOptions } from "../hooks/use-workspace-file";
import { isHtmlFilePath } from "../lib/browser-files";
import {
  fileReferenceBases,
  fileReferenceLabel,
  isAbsoluteFilePath,
  isFileReferenceAbort,
  joinFilePath,
  locationAtMessage,
  readFileTarget,
  resolveFileReference,
  type FileReference,
  type FileReferenceIO,
  type FileReferenceLocation,
} from "../lib/file-reference";
import { showErrorToast } from "../lib/toast-error";
import { sessionFileLocation } from "../services/opencode-resources";
import { palot } from "../services/palot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "./ui/dropdown-menu";
import { toast } from "./ui/toast";

const FIND_LIMIT = 200;

export function createFileReferenceIO(
  queryClient: QueryClient,
  connectionID: string,
): FileReferenceIO {
  return {
    async read(location, path) {
      try {
        // Always re-read: this also fills the cache the file tab renders from.
        await queryClient.fetchQuery({
          ...workspaceFileQueryOptions(connectionID, location, path),
          staleTime: 0,
        });
        return true;
      } catch (error) {
        if (isFileNotFoundError(error)) return false;
        throw error;
      }
    },
    async find(location, query) {
      const entries = await palot.findWorkspaceFiles(
        { ...location, query, limit: FIND_LIMIT },
        undefined,
        connectionID,
      );
      return entries.filter((entry) => entry.type === "file").map((entry) => entry.path);
    },
  };
}

interface FileReferenceOpenerInput {
  sessionID: string;
  location: LocationRef;
  connectionID: string | undefined;
  /** The server shares this machine's filesystem, so external apps can open its paths. */
  localPathActions: boolean;
  getMessages(): readonly PalotMessage[];
  openTab(input: {
    kind: "file";
    location: LocationRef;
    path: string;
    line?: number;
    endLine?: number;
  }): unknown;
  /**
   * Shows an HTML file rendered instead of as source, like OpenCode desktop. Resolves false
   * when the browser cannot load it, and the file opens as a tab instead.
   */
  openHtml?(absolutePath: string): Promise<boolean>;
}

interface PickerState {
  scopeKey: string;
  anchor: HTMLElement | null;
  bases: LocationRef[];
  location: LocationRef;
  query: string;
  candidates: string[];
  line?: number;
  endLine?: number;
}

type OpenEvent = ReactMouseEvent | ReactKeyboardEvent;

export function useFileReferenceOpener({
  sessionID,
  location,
  connectionID,
  localPathActions,
  getMessages,
  openTab,
  openHtml,
}: FileReferenceOpenerInput) {
  const queryClient = useQueryClient();
  const controllerRef = useRef<AbortController | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);

  // A different task or location invalidates any click still resolving.
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, [sessionID, location.directory, location.workspaceID]);

  const openExternally = useCallback(
    (path: string, reference: FileReference) => {
      palot
        .externalOpen(
          {
            resource: {
              kind: "file",
              path,
              ...(reference.line ? { line: reference.line } : {}),
              ...(reference.column ? { column: reference.column } : {}),
              sessionID,
            },
          },
          connectionID,
        )
        .catch((error: unknown) => showErrorToast("Could not open file", error));
    },
    [connectionID, sessionID],
  );

  const scopeKey = `${sessionID}\0${location.workspaceID ?? ""}\0${location.directory}`;

  /** Starts a new resolution and cancels whichever one was still running. */
  const begin = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller;
  }, []);

  /** Bases for a message: where it was written (and its root), then where the task is now. */
  const basesFor = useCallback(
    async (written: FileReferenceLocation) => {
      const session = connectionID
        ? await queryClient
            .fetchQuery({
              queryKey: [
                "palot",
                "file-reference-root",
                connectionID,
                sessionID,
                location.directory,
              ],
              queryFn: ({ signal }) => sessionFileLocation(sessionID, signal, connectionID),
              staleTime: 5 * 60_000,
            })
            .catch(() => undefined)
        : undefined;
      // Only trust the subpath when it describes the location being resolved.
      const current: FileReferenceLocation = {
        location,
        ...(session?.location.directory === location.directory && session.subpath !== undefined
          ? { subpath: session.subpath }
          : {}),
      };
      const writtenHere =
        written.location.directory === location.directory &&
        written.location.workspaceID === location.workspaceID;
      return fileReferenceBases(
        writtenHere && written.subpath === undefined ? current : written,
        current,
      );
    },
    [connectionID, location, queryClient, sessionID],
  );

  const open = useCallback(
    (reference: FileReference, event?: OpenEvent) => {
      const controller = begin();
      setPicker(null);

      const anchor = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      const messageID =
        anchor?.closest<HTMLElement>("[data-message-id]")?.dataset.messageId ?? undefined;
      const written = locationAtMessage(getMessages(), messageID, { location });
      const fallbackPath =
        isAbsoluteFilePath(reference.path) || reference.path.startsWith("~")
          ? reference.path
          : joinFilePath(written.location.directory, reference.path);

      if (event && (event.metaKey || event.ctrlKey)) {
        openExternally(fallbackPath, reference);
        return;
      }

      anchor?.setAttribute("aria-busy", "true");
      void (async () => {
        try {
          const bases = await basesFor(written);
          if (controller.signal.aborted || !connectionID) return;
          const result = await resolveFileReference(
            reference.path,
            bases,
            createFileReferenceIO(queryClient, connectionID),
            controller.signal,
          );
          if (controller.signal.aborted) return;
          if (result.kind === "open") {
            if (
              openHtml &&
              isHtmlFilePath(result.path) &&
              (await openHtml(joinFilePath(result.location.directory, result.path)))
            )
              return;
            if (controller.signal.aborted) return;
            openTab({
              kind: "file",
              location: result.location,
              path: result.path,
              ...lineRange(reference),
            });
            return;
          }
          if (result.kind === "choose") {
            setPicker({
              scopeKey,
              anchor,
              bases,
              location: result.location,
              query: result.query,
              candidates: result.candidates,
              ...lineRange(reference),
            });
            return;
          }
          const path = result.absolutePath ?? fallbackPath;
          if (result.kind === "outside" && localPathActions) {
            openExternally(path, reference);
            return;
          }
          toast.add({
            type: "error",
            title: result.kind === "outside" ? "File is outside this task" : "File not found",
            description: fileReferenceLabel({ ...reference, path }),
            ...(localPathActions
              ? {
                  actionProps: {
                    children: "Open externally",
                    onClick: () => openExternally(path, reference),
                  },
                }
              : {}),
          });
        } catch (error) {
          if (controller.signal.aborted || isFileReferenceAbort(error)) return;
          showErrorToast("Could not open file", error);
        } finally {
          anchor?.removeAttribute("aria-busy");
          if (controllerRef.current === controller) controllerRef.current = null;
        }
      })();
    },
    [
      basesFor,
      begin,
      connectionID,
      getMessages,
      localPathActions,
      location,
      openExternally,
      openHtml,
      openTab,
      queryClient,
      scopeKey,
    ],
  );

  const choose = (state: PickerState, path: string) => {
    setPicker(null);
    if (!connectionID) return;
    const controller = begin();
    void (async () => {
      try {
        // Re-read before opening; the search index can lag behind deletes.
        const target = await readFileTarget(
          state.bases,
          state.location,
          path,
          createFileReferenceIO(queryClient, connectionID),
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!target) {
          toast.add({ type: "error", title: "File not found", description: path });
          return;
        }
        openTab({ kind: "file", ...target, ...lineRange(state) });
      } catch (error) {
        if (controller.signal.aborted || isFileReferenceAbort(error)) return;
        showErrorToast("Could not open file", error);
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    })();
  };

  // A picker belongs to the task and location it was opened for.
  const pickerNode =
    picker && picker.scopeKey === scopeKey ? (
      <FileReferencePicker
        state={picker}
        onClose={() => setPicker(null)}
        onChoose={(path) => choose(picker, path)}
      />
    ) : null;

  return { open, picker: pickerNode };
}

function lineRange(reference: { line?: number; endLine?: number }) {
  if (!reference.line) return {};
  return {
    line: reference.line,
    ...(reference.endLine ? { endLine: reference.endLine } : {}),
  };
}

function FileReferencePicker({
  state,
  onChoose,
  onClose,
}: {
  state: PickerState;
  onChoose(path: string): void;
  onClose(): void;
}) {
  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DropdownMenuContent
        anchor={state.anchor}
        aria-label={`Files matching ${state.query}`}
        className="w-max max-w-[min(32rem,var(--available-width))] min-w-56"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate text-meta">
            {state.candidates.length} files match {state.query}
          </DropdownMenuLabel>
          {state.candidates.map((path) => (
            <DropdownMenuItem key={path} onClick={() => onChoose(path)}>
              <FileCode2 aria-hidden="true" className="text-muted-foreground" />
              <span className="min-w-0 truncate font-mono text-code-compact" title={path}>
                {path}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
