import { memo, useCallback, useState } from "react";
import { Shield, ShieldAlert } from "lucide-react";
import type { ApprovalPreset, SessionApprovalMode } from "../lib/session-permissions";
import {
  ComposerPicker,
  useComposerPickerAction,
  type ComposerPickerSection,
} from "./ui/composer-picker";
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

const SECTIONS: ComposerPickerSection<ApprovalPreset>[] = [
  {
    key: "presets",
    options: [
      {
        key: "normal",
        value: "normal",
        label: "Defaults",
        description: "Use project and agent permission rules.",
      },
      {
        key: "full",
        value: "full",
        label: "Full access",
        description: "Allow tool actions without normal approval prompts.",
        tone: "warning",
      },
    ],
  },
];

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
  const updating = busy || confirmAction.busy;
  // Custom rules match neither preset, so nothing is marked current.
  const selectedKey = mode === "custom" ? null : mode;

  return (
    <>
      <ComposerPicker<ApprovalPreset>
        label={label}
        ariaLabel={`Approvals: ${label}`}
        icon={
          mode === "full" ? (
            <ShieldAlert className="shrink-0" aria-hidden="true" />
          ) : (
            <Shield className="shrink-0" aria-hidden="true" />
          )
        }
        tone={mode === "full" ? "warning" : "default"}
        triggerClassName="shrink-0 gap-1"
        disabled={disabled || updating}
        open={open}
        onOpenChange={onOpenChange}
        popupClassName="w-80"
        title="Approvals for this thread"
        notice={
          mode === "custom"
            ? "Custom session rules are active. Choosing a preset replaces them."
            : undefined
        }
        listLabel="Approval presets"
        sections={SECTIONS}
        selectedKey={selectedKey}
        footer="Existing approval requests still need a reply."
        errorTitle="Could not change permissions"
        confirm={(option) => {
          if (option.value !== "full") return false;
          setError(null);
          setConfirm(true);
          return true;
        }}
        onSelect={(option) => onSelect(option.value)}
        onSelectionComplete={onSelectionComplete}
      />
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
    </>
  );
});
