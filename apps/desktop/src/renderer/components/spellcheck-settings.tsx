import { useMemo, useState } from "react";
import type { SpellcheckSettings, SpellcheckUpdate } from "../../shared/spellcheck-contract";
import {
  spellcheckBridge,
  useSpellcheckSettings,
  useUpdateSpellcheckSettings,
} from "../hooks/use-spellcheck-settings";
import { showErrorToast } from "../lib/toast-error";
import { SettingsDisclosure, SettingsGroup, SettingsRow, SettingsSection } from "./settings-layout";
import { Button } from "./ui/button";
import { CheckList } from "./ui/check-list";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

function languageNamer(): (tag: string) => string {
  const locale = typeof navigator === "undefined" ? "en" : navigator.language;
  let names: Intl.DisplayNames | undefined;
  try {
    // Standard names ("English (United States)") keep Chromium's alias pairs apart.
    names = new Intl.DisplayNames([locale, "en"], {
      type: "language",
      languageDisplay: "standard",
    });
  } catch {
    names = undefined;
  }
  return (tag) => {
    try {
      return names?.of(tag) ?? tag;
    } catch {
      return tag;
    }
  };
}

/** Spelling preferences for Palot's own windows. Hidden outside the desktop app. */
export function SpellcheckSettings() {
  const settings = useSpellcheckSettings();
  const update = useUpdateSpellcheckSettings();
  if (!spellcheckBridge()) return null;
  const data = settings.data;
  const apply = (change: SpellcheckUpdate) =>
    update.mutate(change, {
      onError: (error) => showErrorToast("Could not update spelling settings", error),
    });

  return (
    <SettingsSection
      title="Spelling"
      description="Underline misspelled words in Palot's text fields. Right-click a word for suggestions or to add it to the dictionary. Pages in the task browser aren't affected."
    >
      <SettingsGroup>
        <SettingsRow
          title="Check spelling"
          description={
            data && !data.chooseLanguages
              ? "Uses the macOS spellchecker, which detects the language as you type."
              : "Each language's dictionary downloads from Google the first time it's used."
          }
          control={
            <Switch
              aria-label="Check spelling"
              checked={data?.enabled ?? true}
              disabled={!data}
              onCheckedChange={(checked) => apply({ enabled: Boolean(checked) })}
            />
          }
        />
      </SettingsGroup>
      {data?.chooseLanguages ? (
        <SpellingLanguages settings={data} pending={update.isPending} onChange={apply} />
      ) : null}
    </SettingsSection>
  );
}

function SpellingLanguages({
  settings,
  pending,
  onChange,
}: {
  settings: SpellcheckSettings;
  pending: boolean;
  onChange: (update: SpellcheckUpdate) => void;
}) {
  const [query, setQuery] = useState("");
  const name = useMemo(languageNamer, []);
  const options = useMemo(
    () =>
      settings.available
        .map((tag) => ({ tag, label: name(tag) }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.tag.localeCompare(b.tag)),
    [settings.available, name],
  );
  const needle = query.trim().toLowerCase();
  const only = settings.languages.length === 1 ? settings.languages[0] : undefined;
  const summary = settings.languages.map(name).join(", ") || "Your system language";

  return (
    <SettingsDisclosure
      title="Spelling languages"
      description={`${summary} · ${settings.followsSystem ? "From your system" : "Chosen here"}`}
    >
      <SettingsRow
        title="Languages to check"
        description={
          settings.followsSystem
            ? "Your system languages, plus English (United States) when none of them is English."
            : "Chosen here instead of your system languages."
        }
        status={settings.enabled ? undefined : "Turn on Check spelling to change languages."}
        align="start"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={settings.followsSystem || pending || !settings.enabled}
            onClick={() => onChange({ languages: null })}
          >
            Use system languages
          </Button>
        }
      >
        <div className="space-y-2">
          <Input
            aria-label="Search spelling languages"
            placeholder="Search languages…"
            value={query}
            disabled={!settings.enabled}
            onChange={(event) => setQuery(event.target.value)}
          />
          <CheckList
            aria-label="Spelling languages"
            className="max-h-72 overflow-y-auto"
            disabled={!settings.enabled || pending}
            value={settings.languages}
            onValueChange={(next) => {
              if (next.length > 0) onChange({ languages: next });
            }}
            options={options
              .filter(
                ({ tag, label }) =>
                  !needle ||
                  label.toLowerCase().includes(needle) ||
                  tag.toLowerCase().includes(needle),
              )
              .map(({ tag, label }) => ({
                value: tag,
                label,
                trailing: (
                  <span className="font-mono text-code-compact text-muted-foreground">{tag}</span>
                ),
                disabled: tag === only,
                ...(tag === only
                  ? { disabledReason: "Turn off Check spelling to stop checking." }
                  : {}),
              }))}
          />
        </div>
      </SettingsRow>
    </SettingsDisclosure>
  );
}
