/** The one primary button, from `primaryAction()`, and the Stop that stays beside it. */

import { shortcutPlatform } from "../../lib/keyboard-shortcuts";
import { ComposerPrimary, ComposerStop } from "../ui/composer";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { STOP_LABEL, primaryPresentation, type PrimaryAction } from "./primary-action";

const WAITING_FOR_UPLOAD = "Sends when the upload finishes";

/** Mod is Cmd on macOS, where Ctrl-click means a secondary click. */
function modHeld(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return shortcutPlatform() === "mac" ? event.metaKey : event.ctrlKey;
}

export function ComposerPrimaryControls({
  action,
  sending,
  waitingForUpload = false,
  steerShortcut,
  queueFirstShortcut,
  compactTokens,
  multiModel,
  onSubmit,
  onStop,
  onOpenMultiModel,
}: {
  action: PrimaryAction;
  sending: boolean;
  /** A send is held until an attachment finishes uploading. */
  waitingForUpload?: boolean;
  steerShortcut: string;
  queueFirstShortcut?: string;
  /** Tokens compacting first would summarize, when it is suggested. */
  compactTokens: number | null;
  /** Shift-click on Send opens "Send to several models" (a new task's prompt). */
  multiModel: boolean;
  /** Sends what the composer holds, as the alternate delivery when one is given. */
  onSubmit(alternate?: PrimaryAction["alternate"]): void;
  onStop(): void;
  onOpenMultiModel(): void;
}) {
  const presentation = primaryPresentation(action, {
    steerShortcut,
    queueFirstShortcut,
    multiModel,
    compactTokens,
  });
  // While the agent works the held send's place is Stop, which stays as it is.
  const { view, preview, tooltip } =
    waitingForUpload && action.kind !== "stop"
      ? {
          view: { ...presentation.view, name: WAITING_FOR_UPLOAD },
          preview: undefined,
          tooltip: WAITING_FOR_UPLOAD,
        }
      : presentation;
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerPrimary
              {...view}
              preview={preview}
              busy={sending && action.kind !== "stop"}
              disabled={action.disabled}
              onClick={(event) => {
                if (action.kind === "stop") onStop();
                else if (event.shiftKey && multiModel && action.kind === "send") onOpenMultiModel();
                else if (modHeld(event) && action.alternate) onSubmit(action.alternate);
                else onSubmit();
              }}
            />
          }
        />
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      {action.stop ? (
        <Tooltip>
          <TooltipTrigger render={<ComposerStop aria-label={STOP_LABEL} onClick={onStop} />} />
          <TooltipContent>Stop the agent</TooltipContent>
        </Tooltip>
      ) : null}
    </>
  );
}
