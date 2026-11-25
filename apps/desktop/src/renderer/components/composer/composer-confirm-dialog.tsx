import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

interface ComposerConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
}

/**
 * Asks before the composer does something it cannot take back. `confirm` resolves true only for
 * the confirm button; Escape, Cancel and unmounting resolve false.
 */
export function useComposerConfirm() {
  const [request, setRequest] = useState<ComposerConfirmRequest | null>(null);
  const [open, setOpen] = useState(false);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setOpen(false);
    resolve?.(confirmed);
  }, []);

  useEffect(() => () => resolveRef.current?.(false), []);

  const confirm = useCallback(
    (next: ComposerConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current?.(false);
        resolveRef.current = resolve;
        setRequest(next);
        setOpen(true);
      }),
    [],
  );

  const dialog = (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>{request?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => settle(true)}>
            {request?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}

export type ComposerConfirm = ReturnType<typeof useComposerConfirm>["confirm"];
