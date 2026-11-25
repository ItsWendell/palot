/**
 * The menu of a chip in the text field that came from somewhere: a recent output's chip offers
 * "Open original task". Like links elsewhere, it opens on right-click, the context-menu key or
 * Shift+F10 while the chip is selected. Other chips keep the field's own menu.
 */

import { MessageSquareText } from "lucide-react";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { usePalotNavigation } from "../../hooks/use-navigation";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "../ui/dropdown-menu";

const ORIGIN_CHIP = "[data-composer-chip-origin]";

interface ChipMenuRequest {
  chip: HTMLElement;
  x: number;
  y: number;
  sessionID: string;
  title: string;
}

export function ComposerChipMenu({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const [request, setRequest] = useState<ChipMenuRequest | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const show = (chip: HTMLElement, x?: number, y?: number) => {
      const sessionID = chip.dataset.composerChipOrigin;
      if (!sessionID) return;
      const rect = chip.getBoundingClientRect();
      setRequest({
        chip,
        x: x ?? rect.left,
        y: y ?? rect.bottom,
        sessionID,
        title: chip.dataset.composerChipOriginTitle ?? "",
      });
      setOpen(true);
    };
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const chip = target?.closest<HTMLElement>(ORIGIN_CHIP);
      if (!chip || !root.contains(chip)) return;
      // Palot owns this menu; the native one skips events that were already handled.
      event.preventDefault();
      const keyboard = event.button === 0 && event.clientX === 0 && event.clientY === 0;
      show(chip, keyboard ? undefined : event.clientX, keyboard ? undefined : event.clientY);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      // A chip the caret selected (a click, or Shift+Arrow across it).
      const chip = root.querySelector<HTMLElement>(`${ORIGIN_CHIP}.ProseMirror-selectednode`);
      if (!chip) return;
      event.preventDefault();
      show(chip);
    };
    root.addEventListener("contextmenu", onContextMenu);
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("contextmenu", onContextMenu);
      root.removeEventListener("keydown", onKeyDown);
    };
  }, [rootRef]);

  const anchor = useMemo(
    () =>
      request
        ? { getBoundingClientRect: () => DOMRect.fromRect({ x: request.x, y: request.y }) }
        : null,
    [request],
  );
  if (!request || !anchor) return null;
  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) setRequest(null);
      }}
    >
      <DropdownMenuContent
        anchor={anchor}
        side="top"
        align="start"
        aria-label={`Actions for ${request.chip.getAttribute("aria-label") ?? "chip"}`}
        // The text field keeps the caret; the chip itself takes no focus.
        finalFocus={() =>
          rootRef.current?.querySelector<HTMLElement>("[data-palot-composer-input]") ?? true
        }
        className="w-auto max-w-80 min-w-44"
      >
        <OpenOriginalTaskItem sessionID={request.sessionID} title={request.title} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mounted only while the menu is open, so the composer needs no router until then. */
function OpenOriginalTaskItem({ sessionID, title }: { sessionID: string; title: string }) {
  const { openSession } = usePalotNavigation();
  return (
    <DropdownMenuItem
      title={title || undefined}
      onClick={() => {
        void openSession(sessionID);
      }}
    >
      <MessageSquareText aria-hidden="true" />
      Open original task
    </DropdownMenuItem>
  );
}
