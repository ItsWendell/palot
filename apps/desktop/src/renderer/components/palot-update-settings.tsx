import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PalotUpdateStatus } from "../../shared/palot-update-contract";
import {
  openPalotRelease,
  palotUpdateBridge,
  palotUpdateErrorMessage,
  palotUpdateKey,
  usePalotUpdateStatus,
} from "../hooks/use-palot-update";
import { showErrorToast } from "../lib/toast-error";
import { SettingsNotice, SettingsRow } from "./settings-layout";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

type Outcome = { ok: true; message: string } | { ok: false; message: string };

/** Opt-in notice for a newer stable release, inside About → Updates. Hidden outside the desktop app. */
export function PalotUpdateSettings() {
  const client = useQueryClient();
  const query = usePalotUpdateStatus();
  const [checking, setChecking] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const api = palotUpdateBridge();
  if (!api) return null;
  const status = query.data;
  const save = (next: PalotUpdateStatus) => client.setQueryData(palotUpdateKey, next);

  const checkNow = async () => {
    setChecking(true);
    setOutcome(null);
    try {
      const next = await api.check();
      save(next);
      // The notice below announces a new version itself; a dismissed one is still reported.
      const noticeShown = next.available && next.available.version !== next.dismissedVersion;
      setOutcome(
        noticeShown
          ? null
          : {
              ok: true,
              message: next.available
                ? `Palot ${next.available.version} is available.`
                : "You're up to date.",
            },
      );
    } catch (error) {
      setOutcome({ ok: false, message: palotUpdateErrorMessage(error) });
    } finally {
      setChecking(false);
    }
  };

  const setEnabled = async (enabled: boolean) => {
    setToggling(true);
    setOutcome(null);
    try {
      save(await api.setEnabled(enabled));
    } catch (error) {
      showErrorToast("Could not change update checks", error);
      return;
    } finally {
      setToggling(false);
    }
    if (enabled) await checkNow();
  };

  const dismiss = async (version: string) => {
    try {
      save(await api.dismiss(version));
    } catch (error) {
      showErrorToast("Could not dismiss the update notice", error);
    }
  };

  const supported = status?.supported ?? false;
  const enabled = status?.enabled ?? false;
  const available =
    status?.available && status.available.version !== status.dismissedVersion
      ? status.available
      : null;
  const lastChecked =
    enabled && status?.checkedAt
      ? `Last checked ${new Date(status.checkedAt).toLocaleString()}.`
      : null;

  return (
    <>
      <SettingsRow
        title="Check for Palot updates"
        description={
          status && !supported
            ? "Update checks cover stable releases. This build doesn't check."
            : "Once a day and when you press Check now, Palot asks GitHub for the latest release of its repository. Nothing about you or your work is sent beyond the request itself."
        }
        tone={outcome && !outcome.ok ? "destructive" : "default"}
        status={
          checking ? (
            <span role="status">Checking for updates…</span>
          ) : outcome ? (
            <span role={outcome.ok ? "status" : "alert"}>{outcome.message}</span>
          ) : (
            lastChecked
          )
        }
        control={
          <Switch
            aria-label="Check for Palot updates"
            checked={enabled}
            disabled={!status || !supported || toggling}
            onCheckedChange={(checked) => void setEnabled(Boolean(checked))}
          />
        }
        actions={
          supported ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!enabled || checking || toggling}
              onClick={() => void checkNow()}
            >
              Check now
            </Button>
          ) : null
        }
      />
      {available ? (
        <SettingsNotice
          inGroup
          status="info"
          title={`Palot ${available.version} is available`}
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openPalotRelease(available)}
              >
                Release notes
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void dismiss(available.version)}
              >
                Dismiss for this version
              </Button>
            </>
          }
        >
          Palot updates are manual. The release notes say how to install it.
        </SettingsNotice>
      ) : null}
    </>
  );
}
