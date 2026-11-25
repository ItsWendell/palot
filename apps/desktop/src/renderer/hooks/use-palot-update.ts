import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type { PalotUpdateApi, PalotUpdateRelease } from "../../shared/palot-update-contract";
import { actionableErrorMessage } from "../../shared";
import { toast } from "../components/ui/toast";
import { palot } from "../services/palot";

export const palotUpdateKey = ["palot-update"] as const;
// Announcements are local reads; main does the daily network check on its own schedule.
const ANNOUNCEMENT_POLL = 10 * 60 * 1000;

/** The desktop bridge, or undefined in a renderer preview. */
export function palotUpdateBridge(): PalotUpdateApi | undefined {
  return typeof window === "undefined" ? undefined : window.palot?.palotUpdate;
}

export function usePalotUpdateStatus() {
  const api = palotUpdateBridge();
  return useQuery({
    queryKey: palotUpdateKey,
    queryFn: () => api!.status(),
    enabled: api !== undefined,
  });
}

/** The main-process message without Electron's "Error invoking remote method" wrapper. */
export function palotUpdateErrorMessage(error: unknown): string {
  return actionableErrorMessage(error, "Could not check for Palot updates.").replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    "",
  );
}

export function openPalotRelease(release: PalotUpdateRelease): void {
  void palot.openExternalUrl(release.url);
}

/** Shows one toast per newer version. Main records which version was announced. */
export function usePalotUpdateAnnouncements(): void {
  useEffect(() => {
    const api = palotUpdateBridge();
    if (!api) return;
    const poll = () => {
      api
        .takeAnnouncement()
        .then((release) => {
          // Main has already recorded this version as announced, so show it even if this
          // component unmounted meanwhile; the toast lives outside it.
          if (!release) return;
          toast.add({
            type: "info",
            title: `Palot ${release.version} is available`,
            description: "Palot updates are manual. The release notes say how to install it.",
            actionProps: { children: "Release notes", onClick: () => openPalotRelease(release) },
          });
        })
        .catch(() => undefined);
    };
    poll();
    const timer = window.setInterval(poll, ANNOUNCEMENT_POLL);
    return () => window.clearInterval(timer);
  }, []);
}
