// Adapted from OpenCode v2.2.3 (MIT), Copyright (c) 2025 opencode.
// https://github.com/anomalyco/opencode/blob/v2.2.3/packages/desktop/src/main/native/spellcheck.ts

import { app, session, type IpcMainInvokeEvent } from "electron";
import Store from "electron-store";
import * as v from "valibot";
import {
  SPELLCHECK_IPC_CHANNELS,
  type SpellcheckSettings,
  type SpellcheckUpdate,
} from "../shared/spellcheck-contract";
import { matchSpellcheckLanguages, resolveSpellcheckLanguages } from "./spellcheck-languages";

interface StoredSpellcheck {
  enabled: boolean;
  /** Absent while the languages follow the system. */
  languages?: string[];
}

// macOS checks spelling with the system spellchecker, which detects the language itself;
// Electron ignores dictionary choices there.
const choosesLanguages = process.platform !== "darwin";

let store: Store<StoredSpellcheck> | undefined;
const settingsStore = () =>
  (store ??= new Store<StoredSpellcheck>({ name: "spellcheck", defaults: { enabled: true } }));

function savedLanguages(): string[] | undefined {
  const saved: unknown = settingsStore().get("languages");
  return Array.isArray(saved)
    ? saved.filter((tag): tag is string => typeof tag === "string")
    : undefined;
}

function currentLanguages() {
  return resolveSpellcheckLanguages(
    session.defaultSession.availableSpellCheckerLanguages,
    savedLanguages(),
    app.getPreferredSystemLanguages(),
  );
}

/** Applies the saved preferences to the app session. Call before the first window loads. */
export function applySpellcheck(): void {
  const enabled = settingsStore().get("enabled") !== false;
  const appSession = session.defaultSession;
  if (choosesLanguages) {
    // Chromium fetches its system-locale dictionary even while checking is off, so an
    // off switch clears the list. Otherwise an empty result keeps Chromium's default.
    const languages = enabled ? currentLanguages().languages : [];
    if (languages.length || !enabled) appSession.setSpellCheckerLanguages(languages);
  }
  // Setting languages also turns the spellchecker on, so the on/off state goes last.
  appSession.setSpellCheckerEnabled(enabled);
}

export function spellcheckSettings(): SpellcheckSettings {
  const enabled = settingsStore().get("enabled") !== false;
  if (!choosesLanguages)
    return { enabled, chooseLanguages: false, languages: [], followsSystem: true, available: [] };
  const { languages, followsSystem } = currentLanguages();
  return {
    enabled,
    chooseLanguages: true,
    languages: languages.length ? languages : session.defaultSession.getSpellCheckerLanguages(),
    followsSystem,
    available: [...session.defaultSession.availableSpellCheckerLanguages],
  };
}

export function updateSpellcheck(update: SpellcheckUpdate): SpellcheckSettings {
  if ("enabled" in update) {
    settingsStore().set("enabled", update.enabled);
  } else {
    if (!choosesLanguages) throw new Error("macOS chooses spelling languages itself");
    if (update.languages === null) {
      settingsStore().delete("languages");
    } else {
      const languages = matchSpellcheckLanguages(
        session.defaultSession.availableSpellCheckerLanguages,
        update.languages,
      );
      if (!languages.length) throw new Error("Choose at least one spelling language");
      settingsStore().set("languages", languages);
    }
  }
  applySpellcheck();
  return spellcheckSettings();
}

const tag = v.pipe(v.string(), v.minLength(1), v.maxLength(32));
export const spellcheckUpdateSchema = v.union([
  v.strictObject({ enabled: v.boolean() }),
  v.strictObject({ languages: v.nullable(v.pipe(v.array(tag), v.maxLength(256))) }),
]);

/** Registers through the caller's trusted registrar (main window, main frame, renderer document). */
export function registerSpellcheckIpc(
  register: (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ) => void,
): void {
  register(SPELLCHECK_IPC_CHANNELS.spellcheckLoad, () => spellcheckSettings());
  register(SPELLCHECK_IPC_CHANNELS.spellcheckUpdate, (_event, input) =>
    updateSpellcheck(v.parse(spellcheckUpdateSchema, input)),
  );
}
