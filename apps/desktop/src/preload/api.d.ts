import type { PalotApi } from "../shared/opencode-contract";

declare global {
  interface Window {
    palot: PalotApi;
  }
}

export type {
  PalotSourceControlApi,
  SourceControlChangedEvent,
  SourceControlResult,
} from "../shared/source-control-contract";
