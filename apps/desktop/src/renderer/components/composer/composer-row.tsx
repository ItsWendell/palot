/**
 * The control row under the text field. At rest it holds `+` and the agent on the left; the
 * model pill, the controls at the end and the primary on the right. It never wraps: labels drop
 * first, then end controls fold into `…`.
 */

import { useAtomValue, type Atom } from "jotai";
import { Plus, SquareTerminal, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { ComposerMode } from "../../lib/composer-history";
import { COMPOSER_SHORTCUT_KEYS } from "../../lib/composer-shortcuts";
import { formatShortcut, useShortcutKeys } from "../../lib/keyboard-shortcuts";
import type { SessionApprovalMode } from "../../lib/session-permissions";
import { ApprovalsChip } from "../approval-selector";
import { AgentPicker, ModelPopover } from "../composer-pickers";
import { Button } from "../ui/button";
import { ShortcutKbd } from "../ui/kbd";
import { ComposerActions, ComposerFooter, ComposerPill, ComposerPillLabel } from "../ui/composer";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import type { ComposerCatalogs } from "./use-composer-catalogs";
import type { ComposerMenus } from "./use-composer-menus";

/** The task's approvals, which the launcher changes; the row only shows a chip off Defaults. */
interface ComposerRowApprovals {
  /** Remounts the model popover when the connection or draft changes. */
  identity: string;
  mode: SessionApprovalMode;
}

/** The `+` button: it turns the composer into the launcher and back. */
interface ComposerRowLauncher {
  /** Open from `+` or Mod+/. */
  openAtom: Atom<boolean>;
  listId: string;
  disabled: boolean;
  onToggle(): void;
  /** Opens the launcher drilled into Approvals, for the approvals chip. */
  onOpenApprovals(): void;
}

interface ComposerRowProps {
  mode: ComposerMode;
  /** A message is being sent; selections wait. */
  sending: boolean;
  newTask: boolean;
  launcher: ComposerRowLauncher;
  onExitShell(): void;
  onSelectionComplete(): void;
  /** The text field, where focus returns when a popup closes without a choice. */
  editorElement(): HTMLElement | null;
  catalogs: ComposerCatalogs;
  menus: ComposerMenus;
  approvals: ComposerRowApprovals;
  onManageModels(): void;
  /** "Send to several models" in the model popover; only a new task in normal mode has it. */
  onSendToModels?(): void;
  /** The context pie and voice (foldable), the `…` menu and the primary with Stop. */
  end: ReactNode;
}

export function ComposerRow({
  mode,
  sending,
  newTask,
  launcher,
  onExitShell,
  onSelectionComplete,
  editorElement,
  catalogs,
  menus,
  approvals,
  onManageModels,
  onSendToModels,
  end,
}: ComposerRowProps) {
  const { catalog, selection } = catalogs;
  const session = selection.session;
  const selectionDisabled = sending || selection.busy;
  const shell = mode === "shell";
  return (
    <ComposerFooter data-palot-composer-row>
      <ComposerActions align="start">
        {shell ? (
          <ShellChip onExit={onExitShell} />
        ) : (
          <>
            <LauncherButton launcher={launcher} />
            <AgentPicker
              session={session}
              agents={catalogs.agents}
              defaultAgent={catalogs.defaultAgent}
              loading={catalogs.agentsLoading}
              open={menus.active === "agent"}
              onOpenChange={menus.onOpenChange.agent}
              onSelectionComplete={onSelectionComplete}
              onSelectAgent={selection.selectAgent}
              disabled={selectionDisabled}
            />
            <ApprovalsChip
              mode={approvals.mode}
              disabled={selectionDisabled || launcher.disabled}
              onOpen={launcher.onOpenApprovals}
            />
          </>
        )}
      </ComposerActions>
      <ComposerActions align="end" data-palot-composer-run-controls>
        {shell ? null : (
          <ModelPopover
            key={approvals.identity}
            session={session}
            draft={newTask}
            models={catalogs.pickerModels}
            catalogModels={catalog.models}
            defaultModel={catalog.defaultModel}
            providers={catalog.providers}
            preferenceScope={catalogs.preferenceScope}
            open={menus.active === "model"}
            // Stable, so the memoized popover keeps its model list on unrelated renders.
            onOpenChange={menus.onOpenChange.model}
            finalFocus={editorElement}
            onSelectionComplete={onSelectionComplete}
            onSelectModel={selection.selectModel}
            onSelectVariant={selection.selectVariant}
            onManageModels={onManageModels}
            onSendToModels={onSendToModels}
            disabled={selectionDisabled}
          />
        )}
        {end}
      </ComposerActions>
    </ComposerFooter>
  );
}

function LauncherButton({ launcher }: { launcher: ComposerRowLauncher }) {
  // Only this button follows the launcher, so opening it leaves the rest of the row alone.
  const open = useAtomValue(launcher.openAtom);
  const keys = useShortcutKeys("composer.launcher");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-full"
            aria-label={open ? "Close launcher" : "Add files, commands and more"}
            aria-expanded={open}
            aria-controls={open ? launcher.listId : undefined}
            disabled={launcher.disabled}
            // The text field keeps focus: it holds the launcher's query.
            onMouseDown={(event) => event.preventDefault()}
            onClick={launcher.onToggle}
          />
        }
      >
        <Plus
          aria-hidden="true"
          className={cn(
            "size-4 transition-transform duration-150 ease-out motion-reduce:transition-none",
            open && "rotate-45",
          )}
        />
      </TooltipTrigger>
      <TooltipContent>
        {open ? "Close" : "Files, commands, skills and more"}
        <ShortcutKbd keys={keys} />
      </TooltipContent>
    </Tooltip>
  );
}

function ShellChip({ onExit }: { onExit(): void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerPill
            className="rounded-full bg-secondary px-2.5"
            aria-label="Exit shell mode"
            data-palot-composer-shell-chip
            onClick={onExit}
          />
        }
      >
        <SquareTerminal aria-hidden="true" />
        <ComposerPillLabel>Shell</ComposerPillLabel>
        <X aria-hidden="true" className="size-3!" />
      </TooltipTrigger>
      <TooltipContent>
        {`Exit shell mode · Esc or ${formatShortcut(COMPOSER_SHORTCUT_KEYS["normal-mode"])}`}
      </TooltipContent>
    </Tooltip>
  );
}
