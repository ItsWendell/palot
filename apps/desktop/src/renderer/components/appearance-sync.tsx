/** Synchronize one resolved appearance revision across DOM, Electron, and Pierre workers. */

import { useAtomValue, useSetAtom } from "jotai";
import { useWorkerPool } from "@pierre/diffs/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import {
  appearancePreferencesAtom,
  appearanceRestartRequiredAtom,
  clearLegacyAppearanceMode,
  commitAppearancePreferencesAtom,
  committedAppearancePreferencesAtom,
  replaceAppearancePreferencesAtom,
  resolvedAppearanceAtom,
  systemColorSchemeAtom,
} from "../atoms/appearance";
import { applyAppearanceToRoot, applyNativeSystemAppearanceToRoot } from "../lib/appearance";
import { prepareAppearanceFonts } from "../lib/font-loading";
import { prepareCodeThemes } from "../lib/theme-catalog";
import { palot } from "../services/palot";

export function AppearanceSync() {
  const preferences = useAtomValue(appearancePreferencesAtom);
  const committedPreferences = useAtomValue(committedAppearancePreferencesAtom);
  const resolved = useAtomValue(resolvedAppearanceAtom);
  const systemScheme = useAtomValue(systemColorSchemeAtom);
  const setSystemScheme = useSetAtom(systemColorSchemeAtom);
  const commitPreferences = useSetAtom(commitAppearancePreferencesAtom);
  const replacePreferences = useSetAtom(replaceAppearancePreferencesAtom);
  const setRestartRequired = useSetAtom(appearanceRestartRequiredAtom);
  const generation = useRef(0);
  const committedPreferencesRef = useRef(committedPreferences);

  useLayoutEffect(() => {
    committedPreferencesRef.current = committedPreferences;
  }, [committedPreferences]);

  useLayoutEffect(() => {
    applyAppearanceToRoot(resolved);
  }, [resolved]);

  useEffect(() => {
    void prepareAppearanceFonts(resolved.preferences.uiFont, resolved.preferences.codeFont);
  }, [resolved.preferences.codeFont, resolved.preferences.uiFont]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setSystemScheme(media.matches ? "dark" : "light");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [setSystemScheme]);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    const resolvedScheme =
      preferences.source === "system" && preferences.omarchyTheme
        ? preferences.omarchyTheme.mode
        : preferences.source === "system" || preferences.mode === "system"
          ? systemScheme
          : preferences.mode;
    void prepareCodeThemes(preferences)
      .then(() => palot.updateAppearance({ preferences, resolvedScheme }))
      .then((result) => {
        if (generation.current !== currentGeneration) return;
        commitPreferences(result.preferences);
        if (result.restartRequired) setRestartRequired(true);
        clearLegacyAppearanceMode();
      })
      .catch((error) => {
        if (generation.current !== currentGeneration) return;
        console.error("[appearance] Could not apply appearance", error);
        replacePreferences(committedPreferencesRef.current);
      });
  }, [commitPreferences, preferences, replacePreferences, setRestartRequired, systemScheme]);

  useEffect(() => {
    const api = window.palot;
    if (!api) return;
    return api.onAppearanceChanged(replacePreferences);
  }, [replacePreferences]);

  useEffect(() => {
    const api = window.palot;
    if (!api) return;
    void api.nativeSystemAppearance().then(applyNativeSystemAppearanceToRoot);
    return api.onNativeSystemAppearanceChanged(applyNativeSystemAppearanceToRoot);
  }, []);

  return null;
}

export function PierreAppearanceSync() {
  const resolved = useAtomValue(resolvedAppearanceAtom);
  const workerPool = useWorkerPool();
  const codeThemePair = resolved.codeThemePair;

  useEffect(() => {
    if (!workerPool) return;
    void workerPool.setRenderOptions({ theme: codeThemePair });
  }, [codeThemePair, workerPool]);

  return null;
}
