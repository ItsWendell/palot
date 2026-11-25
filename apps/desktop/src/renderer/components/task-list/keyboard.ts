/**
 * Keys that work from anywhere while the list is mounted: previous and next task (Alt+Up/Down),
 * the next task that needs you (Mod+Alt+A), settling the open task (Mod+Shift+S) and Mod+1…9. Bindings come from the shortcut
 * catalog (`lib/keyboard-shortcuts.ts`), so personal bindings apply; Mod+1…9 is a fixed range.
 */

import { useEffect } from "react";
import { matchesShortcut, shortcutKeys, shortcutPlatform } from "@/lib/keyboard-shortcuts";
import type { TaskListController } from "./controller";

/** Mod held this long shows the row numbers for Mod+1…9. */
export const NUMBERS_DELAY_MS = 200;

export function useTaskListGlobalKeys(controller: TaskListController, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const mac = shortcutPlatform() === "mac";
    const modKey = mac ? "Meta" : "Control";
    let timer: number | null = null;
    const clear = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // A dialog, menu, picker or select keeps its keys; nothing behind it opens a task.
      if (insideOverlay(event.target)) {
        clear();
        return;
      }
      const mod = mac ? event.metaKey : event.ctrlKey;
      if (event.key === modKey) {
        clear();
        timer = window.setTimeout(() => controller.showNumbers(true), NUMBERS_DELAY_MS);
        return;
      }
      if (mod && !event.altKey && !event.shiftKey) {
        const digit = /^Digit([1-9])$/.exec(event.code);
        if (digit) {
          event.preventDefault();
          clear();
          controller.jumpTo(Number(digit[1]));
          return;
        }
      } else clear();
      if (matchesShortcut(event, shortcutKeys("tasks.needs-you.next"))) {
        event.preventDefault();
        controller.openNextNeedingYou();
        return;
      }
      if (matchesShortcut(event, shortcutKeys("task.settle"))) {
        event.preventDefault();
        controller.settleOpen();
        return;
      }
      if (isTextField(event.target)) return;
      const delta = matchesShortcut(event, shortcutKeys("tasks.list.next"))
        ? 1
        : matchesShortcut(event, shortcutKeys("tasks.list.previous"))
          ? -1
          : 0;
      if (delta !== 0) {
        event.preventDefault();
        controller.openAdjacent(delta);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === modKey) {
        clear();
        controller.showNumbers(false);
      }
    };
    const onBlur = () => {
      clear();
      controller.showNumbers(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      clear();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [controller, enabled]);
}

/** Alt+Up/Down moves by word or paragraph in a text field on some platforms; leave it there. */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

const OVERLAY =
  'select, [role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="menubar"], [role="combobox"], [role="listbox"]';

/** Focus inside a dialog, a menu, a combobox, a listbox or a select. */
function insideOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OVERLAY) !== null;
}
