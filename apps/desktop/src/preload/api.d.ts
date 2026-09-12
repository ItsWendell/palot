import type { PalotApi } from "../shared/opencode-contract";

declare global {
  interface Window {
    palot: PalotApi;
  }
}

export {};
