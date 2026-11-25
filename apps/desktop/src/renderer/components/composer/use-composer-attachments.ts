import { atom, useStore, type PrimitiveAtom } from "jotai";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type RefObject,
} from "react";
import {
  MAX_ATTACHMENT_COUNT,
  type PalotAttachmentProgress,
  type PalotFilePickerResult,
} from "../../../shared";
import {
  composerFileSources,
  composerPasteAction,
  composerPasteInput,
  lineCount,
} from "../../lib/composer-paste";
import { WORKSPACE_FILE_DRAG_TYPE } from "../../lib/workspace-file-drag";
import { palot } from "../../services/palot";
import { errorText, type ComposerErrors } from "./use-composer-errors";
import type { ComposerWriter } from "./use-composer-draft";

const REMOTE_ATTACHMENTS_UNAVAILABLE =
  "Local file attachments are unavailable for remote OpenCode servers.";

interface AttachmentRequest {
  id: string;
  unsubscribe: () => void;
  settled: Promise<boolean>;
  settle(ok: boolean): void;
}

export interface ComposerUpload {
  progress: PalotAttachmentProgress | null;
}

/** A long paste kept as an attachment, which "Show in text field" turns back into text. */
export interface PastedText {
  text: string;
  lines: number;
}

// Attachments are keyed by their staged file's URI, which is unique per paste. A handful of
// recent pastes is enough to bring back; older ones stay ordinary attachments.
const PASTED_TEXT_LIMIT = 8;
const pastedTexts = new Map<string, PastedText>();

function rememberPastedText(uri: string, pasted: PastedText) {
  pastedTexts.delete(uri);
  pastedTexts.set(uri, pasted);
  while (pastedTexts.size > PASTED_TEXT_LIMIT) pastedTexts.delete(pastedTexts.keys().next().value!);
}

/** The text a "Pasted text" attachment holds, while this window still has it. */
export function pastedTextFor(uri: string): PastedText | null {
  return pastedTexts.get(uri) ?? null;
}

export function forgetPastedText(uri: string) {
  pastedTexts.delete(uri);
}

/** Files dragged from the operating system, not the app's own workspace-file or task drags. */
function carriesFiles(data: DataTransfer | null): data is DataTransfer {
  return Boolean(
    data && data.types.includes("Files") && !data.types.includes(WORKSPACE_FILE_DRAG_TYPE),
  );
}

/**
 * Picking, pasting, dropping and uploading attachments. One request runs at a time; a new scope
 * cancels it, and a late result from a canceled request is dropped.
 */
export function useComposerAttachments({
  scopeKey,
  connectionID,
  localAttachments,
  isSending,
  writer,
  errors,
}: {
  /** Changes when the draft, task, connection or open edit changes. */
  scopeKey: string;
  connectionID: string | undefined;
  localAttachments: boolean;
  isSending(): boolean;
  writer(): ComposerWriter;
  errors: ComposerErrors;
}) {
  const [upload, setUpload] = useState<ComposerUpload | null>(null);
  /** Files from the operating system are over the task's pane; the card shows the drop state. */
  const [dragOverAtom] = useState<PrimitiveAtom<boolean>>(() => atom(false));
  const requestRef = useRef<AttachmentRequest | null>(null);
  const cancel = useCallback(() => {
    const request = requestRef.current;
    if (!request) return;
    requestRef.current = null;
    request.unsubscribe();
    request.settle(false);
    setUpload(null);
    void palot.cancelAttachmentUpload(request.id).catch(() => undefined);
  }, []);
  useLayoutEffect(() => cancel, [scopeKey, cancel]);

  async function attach(
    prepare: (requestID: string, isCurrent: () => boolean) => Promise<PalotFilePickerResult | null>,
    onAttached?: (result: PalotFilePickerResult) => void,
  ) {
    if (requestRef.current || isSending()) return;
    const target = writer();
    let settle!: (ok: boolean) => void;
    const settled = new Promise<boolean>((resolve) => (settle = resolve));
    const request: AttachmentRequest = {
      id: crypto.randomUUID(),
      unsubscribe: () => {},
      settled,
      settle,
    };
    let ok = false;
    const isCurrent = () => requestRef.current === request;
    requestRef.current = request;
    errors.clear();
    setUpload({ progress: null });
    try {
      request.unsubscribe = palot.onAttachmentProgress((progress) => {
        if (
          isCurrent() &&
          progress.requestID === request.id &&
          progress.connectionID === connectionID
        ) {
          setUpload({ progress });
        }
      });
      const result = await prepare(request.id, isCurrent);
      if (!isCurrent() || !result) return;
      onAttached?.(result);
      errors.setAttachmentErrors(result.errors);
      ok = result.errors.length === 0;
      target.setFiles((current) => {
        const byUri = new Map(current.map((item) => [item.uri, item]));
        for (const item of result.files) byUri.set(item.uri, item);
        return [...byUri.values()];
      });
    } catch (error) {
      if (!isCurrent()) return;
      errors.setAttachmentErrors([errorText(error, "Palot could not attach the selected files.")]);
    } finally {
      request.unsubscribe();
      if (isCurrent()) {
        requestRef.current = null;
        setUpload(null);
      }
      request.settle(ok);
    }
  }

  async function pickFiles() {
    if (!localAttachments) {
      errors.setAttachmentErrors([REMOTE_ATTACHMENTS_UNAVAILABLE]);
      return;
    }
    await attach((requestID) => palot.pickFiles(connectionID, requestID));
  }

  /**
   * Files pasted or dropped from the operating system. Files with a path attach by path, exactly
   * as if picked; images without one, such as screenshots, are staged from their bytes. Other
   * files without a path cannot be read, so they are named instead.
   */
  async function attachFiles(files: File[]) {
    if (!localAttachments) {
      errors.setAttachmentErrors([REMOTE_ATTACHMENTS_UNAVAILABLE]);
      return;
    }
    const { byPath, overLimit, images, unsupported } = composerFileSources(
      files,
      palot.pathForFile,
      MAX_ATTACHMENT_COUNT,
    );
    const refused = unsupported.map(
      (file) =>
        `${file.name || "This file"}: only images can be pasted or dropped. Use Attach files for other files.`,
    );
    if (overLimit.length > 0) refused.push(`Attach up to ${MAX_ATTACHMENT_COUNT} files at a time.`);
    if (byPath.length === 0 && images.length === 0) {
      errors.setAttachmentErrors(refused);
      return;
    }
    await attach(
      async (requestID, isCurrent) => {
        const result: PalotFilePickerResult = { files: [], errors: [] };
        const add = (part: PalotFilePickerResult) => {
          result.files.push(...part.files);
          result.errors.push(...part.errors);
        };
        if (byPath.length > 0) add(await palot.attachDroppedFiles(byPath, connectionID, requestID));
        if (images.length > 0) {
          const prepared = await Promise.all(
            images.map(async (image) => ({ mime: image.type, data: await image.arrayBuffer() })),
          );
          if (!isCurrent()) return null;
          add(await palot.attachClipboardImages(prepared, connectionID, requestID));
        }
        return result;
      },
      (result) => result.errors.push(...refused),
    );
  }

  async function attachText(text: string) {
    await attach(
      (requestID) => palot.attachClipboardText(text, connectionID, requestID),
      (result) => {
        for (const file of result.files)
          rememberPastedText(file.uri, { text, lines: lineCount(text) });
      },
    );
  }

  /**
   * The attachment half of the paste rules (`lib/composer-paste.ts`): files attach and long text
   * becomes a "Pasted text" attachment. Everything else is the editor's to insert.
   */
  function handlePaste(event: ClipboardEvent<HTMLElement>, prompt = true) {
    const action = composerPasteAction(composerPasteInput(event.clipboardData), {
      plain: false,
      attachments: prompt,
      selectedText: null,
    });
    if (action.kind === "attach-files") {
      event.preventDefault();
      void attachFiles(action.files);
      return;
    }
    // A remote server cannot stage text; the editor types it instead.
    if (action.kind === "attach-text" && localAttachments) {
      event.preventDefault();
      void attachText(action.text);
    }
  }

  return {
    upload,
    dragOverAtom,
    /** An attachment request is running; nothing may be sent until it settles. */
    busy: () => requestRef.current !== null,
    /**
     * Resolves when the running request ends: true when everything attached, false when it
     * failed, refused a file, or was canceled. True at once when nothing runs.
     */
    settled: () => requestRef.current?.settled ?? Promise.resolve(true),
    cancel,
    pickFiles,
    attachFiles,
    handlePaste,
  };
}

export type ComposerAttachments = ReturnType<typeof useComposerAttachments>;

/**
 * Files dragged from the operating system onto the task's pane (the `main` element around the
 * composer, or the card when there is none) attach. The app's own drags (workspace files, task
 * rows) carry their own types and are left to their handlers.
 */
export function useComposerFileDrop({
  rootRef,
  attachments,
  disabled,
}: {
  rootRef: RefObject<HTMLElement | null>;
  attachments: ComposerAttachments;
  /** Shell mode, a request or a send in progress: files are refused, not attached. */
  disabled: boolean;
}) {
  const store = useStore();
  const latest = useRef({ attachments, disabled });
  useLayoutEffect(() => {
    latest.current = { attachments, disabled };
  });
  const { dragOverAtom } = attachments;

  useEffect(() => {
    const zone = rootRef.current?.closest("main") ?? rootRef.current;
    if (!zone) return;
    const setOver = (over: boolean) => {
      if (store.get(dragOverAtom) !== over) store.set(dragOverAtom, over);
    };
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      const refused = latest.current.disabled;
      event.dataTransfer.dropEffect = refused ? "none" : "copy";
      setOver(!refused);
    };
    const onDragLeave = (event: DragEvent) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !zone.contains(next)) setOver(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      setOver(false);
      const files = Array.from(event.dataTransfer.files);
      if (latest.current.disabled || files.length === 0) return;
      void latest.current.attachments.attachFiles(files);
    };
    const onDragEnd = () => setOver(false);
    zone.addEventListener("dragenter", onDragOver);
    zone.addEventListener("dragover", onDragOver);
    zone.addEventListener("dragleave", onDragLeave);
    zone.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("drop", onDragEnd);
    return () => {
      zone.removeEventListener("dragenter", onDragOver);
      zone.removeEventListener("dragover", onDragOver);
      zone.removeEventListener("dragleave", onDragLeave);
      zone.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("drop", onDragEnd);
      setOver(false);
    };
  }, [dragOverAtom, rootRef, store]);
}
