/**
 * The composer's layout on the `ui/composer` primitives: what sits above the card, the slots the
 * card offers (notice, tabs, panel, queue, header), the message area, the row, and the context
 * line under the card. Feature code fills the slots; the card only places them.
 */

import { useAtomValue, type Atom } from "jotai";
import { Fragment, type ReactNode, type Ref } from "react";
import { cn } from "../../lib/cn";
import { WORKSPACE_FILE_DRAG_TYPE } from "../../lib/workspace-file-drag";
import {
  Composer,
  ComposerDock,
  ComposerHeader,
  ComposerPanel,
  type ComposerMode,
} from "../ui/composer";
import { SurfaceBackdrop } from "../ui/surface-backdrop";

/** What fills the one panel that grows from the card's top edge. */
export interface ComposerPanelSlot {
  /** Identity of the content; a new key cross-fades while the height follows. */
  key: string;
  /** Accessible name of the panel region. */
  label: string;
  content: ReactNode;
  /** Escape inside the panel. */
  onClose?(): void;
}

/**
 * The places around the message that other parts fill. Each is optional; an empty slot takes no
 * room. The card decides where they sit, never what they contain.
 */
export interface ComposerSlots {
  /** One condition line above the card (`ComposerNotice`). */
  notice?: ReactNode;
  /** Standing context on the card's top edge (`ComposerTabs`). */
  tabs?: ReactNode;
  /** The panel slot under the top edge: launcher, request or a tab's panel, one at a time. */
  panel?: ComposerPanelSlot | null;
  /** Messages already written, inside the card above the chips. */
  queue?: ReactNode;
  /** Chips above the text field, laid out in one row by `ComposerHeader`. */
  header?: ReactNode;
}

export function ComposerCard({
  ref,
  mode,
  historyMode,
  dragOverAtom,
  dropDisabled,
  onWorkspaceFileDrop,
  stack,
  slots,
  contextBar,
  footer,
  children,
}: {
  ref: Ref<HTMLDivElement>;
  /** What the card is doing; its parts restyle from it. */
  mode: ComposerMode;
  /** The editor's own mode, exposed for scenarios and styles that predate `mode`. */
  historyMode: "normal" | "shell";
  /** Files dragged from the OS are over the composer; the card shows where they will land. */
  dragOverAtom: Atom<boolean>;
  /** Workspace files cannot be dropped in as mentions right now. */
  dropDisabled: boolean;
  /** Receives the drag payload of a workspace file dropped on the composer. */
  onWorkspaceFileDrop(data: string): void;
  /** Dialogs and the suggestion list, which still sit above the card. */
  stack: ReactNode;
  slots: ComposerSlots;
  contextBar?: ReactNode;
  /** The control row. */
  footer: ReactNode;
  /** The message area: the text field or the request in its place, and their error lines. */
  children: ReactNode;
}) {
  const { notice, tabs, panel, queue, header } = slots;
  // Read here, not in the view, so dragging re-renders the card's frame and nothing inside.
  const dragOver = useAtomValue(dragOverAtom);
  return (
    <ComposerDock
      ref={ref}
      role="group"
      aria-label="Composer"
      data-focus-region="composer"
      data-palot-composer-mode={historyMode}
      onDragOver={(event) => {
        if (dropDisabled || !event.dataTransfer.types.includes(WORKSPACE_FILE_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes(WORKSPACE_FILE_DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        if (dropDisabled) return;
        onWorkspaceFileDrop(event.dataTransfer.getData(WORKSPACE_FILE_DRAG_TYPE));
      }}
      className={cn(
        "palot-composer-shell w-[calc(100%-32px)] pb-2 max-[720px]:w-[calc(100%-20px)]",
        contextBar ? "max-w-[860px]" : "max-w-[760px]",
      )}
    >
      {stack}
      {notice}
      {tabs}
      <div className="relative z-10">
        <Composer mode={mode} dragOver={dragOver} className="z-10">
          <ComposerPanel
            open={Boolean(panel)}
            aria-label={panel?.label}
            onOpenChange={(open) => {
              if (!open) panel?.onClose?.();
            }}
          >
            {panel ? <Fragment key={panel.key}>{panel.content}</Fragment> : null}
          </ComposerPanel>
          {queue}
          {/* Chip parts render nothing when empty, so the header takes no room then. */}
          {header ? <ComposerHeader className="empty:hidden">{header}</ComposerHeader> : null}
          {children}
          {footer}
        </Composer>
        {contextBar ? (
          <div className="palot-composer-context palot-composer-context-compact relative isolate z-0 mx-[22px] -mt-4 flex min-h-12 items-end overflow-hidden rounded-b-[16px] border-0 px-3 pt-4 pb-1">
            <SurfaceBackdrop tone="composer" />
            {contextBar}
          </div>
        ) : null}
      </div>
    </ComposerDock>
  );
}
