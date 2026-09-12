import { memo, useState } from "react";
import { ChevronDown, Shield, ShieldAlert } from "lucide-react";
import type { ApprovalPreset, SessionApprovalMode } from "../lib/session-permissions";
import { cn } from "../lib/cn";
import { showErrorToast } from "../lib/toast-error";
import { InputGroupButton } from "./ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
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

export const ApprovalSelector = memo(function ApprovalSelector({
  mode,
  busy,
  disabled,
  open,
  onOpenChange,
  onSelect,
  onSelectionComplete,
}: {
  mode: SessionApprovalMode;
  busy: boolean;
  disabled: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelect(mode: ApprovalPreset): Promise<void>;
  onSelectionComplete(): void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = mode === "full" ? "Full access" : mode === "custom" ? "Custom" : "Defaults";

  async function apply(next: ApprovalPreset) {
    if (busy || disabled) return;
    setError(null);
    try {
      await onSelect(next);
      setConfirm(false);
      onOpenChange(false);
      onSelectionComplete();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not change permissions.");
      showErrorToast("Could not change permissions", error);
    }
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          render={
            <InputGroupButton
              type="button"
              size="composer"
              aria-label={`Approvals: ${label}`}
              disabled={disabled || busy}
              className={cn("shrink-0 gap-1 px-2", mode === "full" && "text-warning")}
            />
          }
        >
          {mode === "full" ? <ShieldAlert aria-hidden="true" /> : <Shield aria-hidden="true" />}
          <span>{label}</span>
          <ChevronDown aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-80 max-w-[calc(100vw-24px)]">
          {mode === "custom" && (
            <p className="px-2 py-1 text-meta text-muted-foreground">
              Custom session rules are active. Choosing a preset replaces them.
            </p>
          )}
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(value) => {
              if (busy || disabled || value === mode) return;
              if (value === "full") {
                onOpenChange(false);
                setError(null);
                setConfirm(true);
              } else if (value === "normal") void apply("normal");
            }}
          >
            <DropdownMenuLabel>Approvals for this thread</DropdownMenuLabel>
            <DropdownMenuRadioItem value="normal" disabled={disabled || busy}>
              <div>
                <div>Defaults</div>
                <div className="text-meta text-muted-foreground">
                  Use project and agent permission rules.
                </div>
              </div>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="full"
              disabled={disabled || busy}
              className="text-warning"
            >
              <div>
                <div>Full access</div>
                <div className="text-meta text-muted-foreground">
                  Allow tool actions without normal approval prompts.
                </div>
              </div>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <p className="px-2 py-1 text-meta text-muted-foreground">
            Existing approval requests still need a reply.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={confirm}
        onOpenChange={(value) => {
          if (!busy) setConfirm(value);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable Full access?</AlertDialogTitle>
            <AlertDialogDescription>
              This overrides project and agent tool-permission rules for this thread, including Plan
              edit restrictions. Commands can modify files and use the network with the OpenCode
              service user's access. It does not grant additional OS privileges or bypass permission
              plugins.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-meta text-muted-foreground">
            New subagents inherit these rules; existing subagents and pending approvals are
            unchanged. You can return to Defaults, but this will not stop commands already running.
          </p>
          {error && (
            <p role="alert" className="text-meta text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={disabled || busy} onClick={() => void apply("full")}>
              {busy ? "Updating permissions…" : "Enable Full access"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
