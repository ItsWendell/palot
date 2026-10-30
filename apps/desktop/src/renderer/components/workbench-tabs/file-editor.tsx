import { Editor, type EditorFactory } from "@pierre/diffs/edit";
import {
  EditProvider,
  File,
  type FileOptions,
  type SelectedLineRange,
  type FileProps,
} from "@pierre/diffs/react";
import { QueryClientContext } from "@tanstack/react-query";
import { useStore } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { workbenchFileEditsAtom } from "../../atoms/workbench-file-edits";
import { runtimeAtom } from "../../atoms/workspace";
import { contentCacheKey } from "../../lib/file-diffs";
import { openCodeKeys } from "../../lib/opencode-query";
import { showErrorToast } from "../../lib/toast-error";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { openCodeClient } from "../../services/opencode-client";
import { pierreViewerStyle } from "../file-viewer-theme";
import { FileEditSession } from "./file-save";

const createEditor: EditorFactory<undefined, undefined> = (type, options) =>
  new Editor(type, options);

export function useFileEditing(
  tab: Extract<WorkbenchTab, { kind: "file" }>,
  data: Uint8Array | undefined,
  text: string | undefined,
) {
  const store = useStore();
  const queryClient = useContext(QueryClientContext);
  const session = useMemo(
    () => store.get(workbenchFileEditsAtom).get(tab.id) ?? new FileEditSession(),
    [store, tab.id, tab.resource.path],
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    const sessions = store.get(workbenchFileEditsAtom);
    if (sessions.get(tab.id) !== session)
      store.set(workbenchFileEditsAtom, new Map(sessions).set(tab.id, session));
  }, [session, store, tab.id]);
  useEffect(() => {
    if (data) session.receive(data, text);
  }, [data, session, text]);

  const save = useCallback(
    async (overwrite = false) => {
      const runtime = store.get(runtimeAtom);
      if (runtime?.profileID !== tab.resource.profileID) return;
      const { connectionID } = runtime;
      const { location, path } = tab.resource;
      try {
        if (!queryClient) throw new Error("File editing requires a query cache");
        const client = openCodeClient(connectionID);
        await session.save(
          {
            canWrite: () => {
              const current = store.get(runtimeAtom);
              return (
                current?.connectionID === connectionID &&
                current.profileID === tab.resource.profileID &&
                store.get(workbenchFileEditsAtom).get(tab.id) === session
              );
            },
            read: () => client.file.read({ location, path }),
            write: (payload) => client.experimental.file.write({ location, path, payload }),
            saved: async (payload) => {
              const queryKey = openCodeKeys.file(connectionID, location, path);
              await queryClient.cancelQueries({ queryKey, exact: true });
              queryClient.setQueryData(queryKey, payload);
            },
          },
          overwrite,
        );
      } catch (error) {
        showErrorToast("Could not save file", error);
      }
    },
    [queryClient, session, store, tab.id, tab.resource],
  );
  const revert = useCallback(() => {
    try {
      session.revert();
    } catch (error) {
      showErrorToast("Could not reload file", error);
    }
  }, [session]);
  const reload = useCallback(async () => {
    const runtime = store.get(runtimeAtom);
    if (runtime?.profileID !== tab.resource.profileID || state.saving) return;
    try {
      const { location, path } = tab.resource;
      const data = await openCodeClient(runtime.connectionID).file.read({ location, path });
      session.receive(data);
      session.revert();
      queryClient?.setQueryData(openCodeKeys.file(runtime.connectionID, location, path), data);
    } catch (error) {
      showErrorToast("Could not reload file", error);
    }
  }, [queryClient, session, state.saving, store, tab.resource]);
  return { state, session, save, revert, reload };
}

/** Keep the external File stable while Pierre owns an edit, preserving cursor and undo history. */
export function FileEditor({
  path,
  contents,
  generation,
  editable,
  onChange,
  selectedLines,
  options,
  lineAnnotations,
  renderAnnotation,
}: {
  path: string;
  contents: string;
  generation: number;
  editable: boolean;
  onChange(contents: string): void;
  selectedLines: SelectedLineRange | null;
  options: FileOptions<undefined, undefined>;
  lineAnnotations?: FileProps<undefined, undefined>["lineAnnotations"];
  renderAnnotation?: FileProps<undefined, undefined>["renderAnnotation"];
}) {
  const makeSource = () => ({
    path,
    generation,
    editable,
    file: { name: path, contents, cacheKey: contentCacheKey(path, contents) },
  });
  const [source, setSource] = useState(makeSource);
  if (source.path !== path || source.generation !== generation || source.editable !== editable)
    setSource(makeSource());
  const editorOptions = useMemo(() => ({}), []);
  const renderOptions = useMemo(() => ({ ...options, useTokenTransformer: true }), [options]);
  return (
    <EditProvider createEditor={createEditor}>
      <File
        file={source.file}
        edit={editable}
        editorOptions={editorOptions}
        // Editable token offsets must be produced together with the main-thread editor,
        // not by the app's read-only worker pool (which does not enable token transforms).
        disableWorkerPool={editable}
        onEditChange={({ file }) => onChange(file.contents)}
        selectedLines={selectedLines}
        options={renderOptions}
        lineAnnotations={lineAnnotations}
        renderAnnotation={renderAnnotation}
        style={pierreViewerStyle}
        className="min-w-full"
      />
    </EditProvider>
  );
}
