import { useEffect, useEffectEvent, type RefObject } from "react";
import type { ComposerMode } from "../../lib/composer-history";
import { matchComposerShortcut } from "../../lib/composer-shortcuts";
import { nextReasoningVariant } from "../../lib/model-picker";
import { resolveModelSelection } from "../../lib/model-selection";
import { primaryAgents } from "../../lib/selection-memory";
import { showErrorToast } from "../../lib/toast-error";
import type { ComposerCatalogs } from "./use-composer-catalogs";
import type { ComposerMenus } from "./use-composer-menus";

/** Whether a key event's target leaves the composer's window-wide shortcuts alone. */
function belongsElsewhere(target: EventTarget | null, root: HTMLElement | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-workbench-terminal]")) return true;
  // Leave other text fields alone; the composer's own input and non-editable focus qualify.
  const editable =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);
  return editable && !root?.contains(target);
}

/**
 * The composer's window-wide shortcuts: model picker, reasoning and agent cycling, attach, and
 * shell mode. An agent cycle pressed before the agent list loaded runs once it settles.
 */
export function useComposerShortcuts({
  draftScope,
  disabled,
  rootRef,
  selectionDisabled,
  attachDisabled,
  catalogs,
  menus,
  attach,
  setMode,
}: {
  draftScope: string;
  /** A request card or a missing workspace owns the composer. */
  disabled: boolean;
  rootRef: RefObject<HTMLElement | null>;
  /** Sending or a selection change in flight. */
  selectionDisabled: boolean;
  attachDisabled: boolean;
  catalogs: ComposerCatalogs;
  menus: ComposerMenus;
  attach(): void;
  setMode(mode: ComposerMode): void;
}) {
  const { catalog, selection } = catalogs;

  async function cycleAgent(direction: 1 | -1) {
    const available = primaryAgents(catalogs.agents);
    if (available.length === 0) return;
    const currentID = selection.session.agent ?? available[0]!.id;
    const index = Math.max(
      0,
      available.findIndex((agent) => agent.id === currentID),
    );
    const next = available[(index + direction + available.length) % available.length];
    if (!next || next.id === currentID) return;
    try {
      await selection.selectAgent(next);
    } catch (error) {
      showErrorToast("Could not switch agents", error);
    }
  }

  async function cycleReasoning() {
    const selected = resolveModelSelection(
      catalog.models,
      selection.session.model,
      catalog.defaultModel,
    ).model;
    if (!selected || selected.variants.length === 0) return;
    const variant = nextReasoningVariant(selected.variants, selection.session.model?.variant);
    try {
      await selection.selectVariant({
        id: selected.id,
        providerID: selected.providerID,
        ...(variant ? { variant } : {}),
      });
    } catch (error) {
      showErrorToast("Could not change reasoning effort", error);
    }
  }

  const applyPendingAgentCycle = useEffectEvent((direction: 1 | -1) => {
    void cycleAgent(direction);
  });

  // Agents load on demand; apply a shortcut-triggered cycle once the catalogs settle.
  const pendingCycle = menus.agentCycle?.scope === draftScope ? menus.agentCycle : null;
  const { setAgentCycle } = menus;
  /* eslint-disable react-hooks-compiler/set-state-in-effect */
  useEffect(() => {
    if (!pendingCycle) return;
    if (catalogs.failed) {
      setAgentCycle(null);
      return;
    }
    if (!catalogs.ready) return;
    setAgentCycle(null);
    applyPendingAgentCycle(pendingCycle.direction);
  }, [catalogs.failed, catalogs.ready, pendingCycle, setAgentCycle]);
  /* eslint-enable react-hooks-compiler/set-state-in-effect */

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (
      disabled ||
      event.defaultPrevented ||
      event.isComposing ||
      event.getModifierState("AltGraph")
    )
      return;
    const shortcut = matchComposerShortcut(event);
    if (!shortcut || belongsElsewhere(event.target, rootRef.current)) return;
    if (document.querySelector('[data-slot="dialog-content"][data-open]')) return;
    event.preventDefault();
    switch (shortcut) {
      case "model":
        if (!selectionDisabled) menus.open("model");
        return;
      case "reasoning-cycle":
        if (!selectionDisabled) void cycleReasoning();
        return;
      case "agent-next":
      case "agent-previous": {
        if (selectionDisabled) return;
        const direction = shortcut === "agent-next" ? 1 : -1;
        if (catalogs.ready) void cycleAgent(direction);
        else setAgentCycle({ scope: draftScope, direction });
        return;
      }
      case "attach":
        if (!attachDisabled) attach();
        return;
      case "shell-mode":
        setMode("shell");
        return;
      case "normal-mode":
        setMode("normal");
        return;
    }
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleShortcut(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
