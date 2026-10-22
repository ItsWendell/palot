import type { PalotApi } from "../shared/opencode-contract";
import type { PalotVoiceOverlayApi } from "../shared/voice-contract";

declare global {
  interface Window {
    palot: PalotApi;
    /** Only defined in the floating voice overlay window (preload/voice-overlay.ts). */
    palotVoiceOverlay?: PalotVoiceOverlayApi;
  }
}

export type {
  PalotSourceControlApi,
  SourceControlChangedEvent,
  SourceControlResult,
} from "../shared/source-control-contract";

export type {
  PalotProjectScriptsApi,
  ProjectScript,
  ProjectScriptRun,
  ProjectScriptsState,
} from "../shared/project-scripts-contract";
