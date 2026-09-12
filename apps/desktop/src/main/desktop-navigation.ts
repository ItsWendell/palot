import type { PalotOpenTarget } from "../shared/opencode-contract";

type OpenTarget = (target: PalotOpenTarget) => void | Promise<void>;

let pendingTarget: PalotOpenTarget | null = null;
let openTarget: OpenTarget | null = null;

export const desktopNavigation = {
  request(target: PalotOpenTarget): void {
    pendingTarget = target;
    void openTarget?.(target);
  },

  take(): PalotOpenTarget | null {
    const target = pendingTarget;
    pendingTarget = null;
    return target;
  },

  setOpenTarget(handler: OpenTarget): void {
    openTarget = handler;
  },
};
