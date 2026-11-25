/**
 * Approvals for a task: Defaults, or Full access after an explicit confirmation; any other
 * session rules read as Custom. The composer changes them in the launcher's Approvals entry and
 * shows a warning chip while they are not Defaults.
 */

import { useCallback, useState, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import type { ApprovalPreset, SessionApprovalMode } from "../lib/session-permissions";
import { useComposerPickerAction } from "./ui/composer-picker";
import { ComposerPill, ComposerPillLabel } from "./ui/composer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const MODE_LABEL: Record<SessionApprovalMode, string> = {
  normal: "Defaults",
  full: "Full access",
  custom: "Custom",
};

export interface ApprovalChoiceOptions {
  busy: boolean;
  disabled: boolean;
  onSelect(mode: ApprovalPreset): Promise<void>;
  onSelectionComplete(): void;
}

/**
 * Choosing a preset: Defaults applies at once, Full access asks first in a dialog. Returns
 * `choose`, whether a change is in flight, and the dialog to render beside the control.
 */
export function useApprovalChoice({
  busy,
  disabled,
  onSelect,
  onSelectionComplete,
}: ApprovalChoiceOptions) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = useCallback(() => {
    setConfirm(false);
    onSelectionComplete();
  }, [onSelectionComplete]);
  const failed = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : "Could not change permissions.");
  }, []);
  const confirmAction = useComposerPickerAction({
    errorTitle: "Could not change permissions",
    onSuccess: confirmed,
    onError: failed,
  });
  const defaultsAction = useComposerPickerAction({ errorTitle: "Could not change permissions" });
  const updating = busy || confirmAction.busy || defaultsAction.busy;

  const choose = (preset: ApprovalPreset) => {
    if (disabled || updating) return;
    if (preset === "full") {
      setError(null);
      setConfirm(true);
    } else void defaultsAction.run(() => onSelect("normal"));
  };

  const dialog = (
    <AlertDialog
      open={confirm}
      onOpenChange={(value) => {
        if (!updating) setConfirm(value);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Enable Full access?</AlertDialogTitle>
          <AlertDialogDescription>
            This overrides project and agent tool-permission rules for this thread, including Plan
            edit restrictions. Commands can modify files and use the network with the OpenCode
            service user&apos;s access. It does not grant additional OS privileges or bypass
            permission plugins.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-meta text-muted-foreground">
          New subagents inherit these rules; existing subagents and pending approvals are unchanged.
          You can return to Defaults, but this will not stop commands already running.
        </p>
        {error && (
          <p role="alert" className="text-meta text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={updating}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={disabled || updating}
            onClick={() => {
              setError(null);
              void confirmAction.run(() => onSelect("full"));
            }}
          >
            {updating ? "Updating permissions…" : "Enable Full access"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { choose, updating, dialog };
}

/**
 * The row's reminder that approvals are not Defaults. Hidden at Defaults; pressing it opens
 * the launcher on Approvals, where they change.
 */
export function ApprovalsChip({
  mode,
  disabled,
  onOpen,
}: {
  mode: SessionApprovalMode;
  disabled: boolean;
  onOpen(): void;
}): ReactNode {
  if (mode === "normal") return null;
  const label = MODE_LABEL[mode];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerPill
            tone="warning"
            compact="icon"
            aria-label={`Approvals: ${label}`}
            disabled={disabled}
            data-palot-approvals-chip
            onClick={onOpen}
          />
        }
      >
        <ShieldAlert aria-hidden="true" />
        <ComposerPillLabel>{label}</ComposerPillLabel>
      </TooltipTrigger>
      <TooltipContent>
        {mode === "full"
          ? "The agent runs commands and edits files without asking"
          : "Custom approval rules for this task"}
      </TooltipContent>
    </Tooltip>
  );
}
