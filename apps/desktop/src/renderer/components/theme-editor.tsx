import { useAtom, useAtomValue } from "jotai";
import { useState, type CSSProperties } from "react";
import {
  appearanceTheme,
  APPEARANCE_THEME_IDS,
  customThemeVariant,
  type AppearanceThemePalette,
} from "../../shared/appearance-contract";
import {
  isThemeColor,
  normalizeCustomTheme,
  MAX_CUSTOM_THEMES,
  MAX_THEME_BYTES,
  type CustomTheme,
} from "../../shared/custom-theme";
import { appearancePreferencesAtom, resolvedAppearanceAtom } from "../atoms/appearance";
import { exportCustomTheme, importCustomTheme } from "../lib/custom-theme-import";
import { SettingsGroup, SettingsNotice, SettingsRow, SettingsSection } from "./settings-layout";
import { Button } from "./ui/button";
import { CopyField } from "./ui/copy-field";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

const ROLES: Array<[keyof AppearanceThemePalette, string]> = [
  ["background", "Background"],
  ["foreground", "Foreground"],
  ["primary", "Action / accent"],
  ["primaryForeground", "Action text"],
  ["card", "Surface"],
  ["popover", "Popover"],
  ["muted", "Muted surface"],
  ["mutedForeground", "Muted text"],
  ["accent", "Selection surface"],
  ["border", "Border"],
  ["ring", "Focus ring"],
  ["sidebar", "Sidebar"],
  ["sidebarForeground", "Sidebar text"],
  ["destructive", "Destructive"],
  ["warning", "Warning"],
  ["success", "Success"],
  ["info", "Information"],
  ["codeBackground", "Code background"],
  ["codeForeground", "Code text"],
];

function pickerColor(color: string, preserveAlpha = false): string {
  // Resolve built-in oklch and color-mix palettes to sRGB for the native color input.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "#808080";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const bytes = [...context.getImageData(0, 0, 1, 1).data];
  return `#${bytes
    .slice(0, preserveAlpha && bytes[3] !== 255 ? 4 : 3)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function ThemeEditor() {
  const [preferences, setPreferences] = useAtom(appearancePreferencesAtom);
  const resolved = useAtomValue(resolvedAppearanceAtom);
  const [draft, setDraft] = useState<CustomTheme | null>(null);
  const [importing, setImporting] = useState(false);
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const canCreate = preferences.customThemes.length < MAX_CUSTOM_THEMES;
  const create = () => {
    const selected = resolved.scheme === "light" ? preferences.lightTheme : preferences.darkTheme;
    const existing = preferences.customThemes.find((theme) => theme.id === selected);
    const variant = appearanceTheme(preferences, resolved.scheme);
    // Copy the active palette, including native/system colors, without persisting arbitrary CSS.
    const colors = Object.fromEntries(
      Object.entries(variant.palette).map(([role, color]) => [role, pickerColor(color, true)]),
    );
    setError(null);
    setDraft({
      id: `custom:${crypto.randomUUID()}`,
      name: existing ? `${existing.name} copy`.slice(0, 80) : "My theme",
      scheme: resolved.scheme,
      base:
        existing?.base ??
        (selected.startsWith("custom:") ? "palot" : (selected as CustomTheme["base"])),
      colors,
      ...(existing?.tokenColors ? { tokenColors: existing.tokenColors } : {}),
    });
  };
  const save = () => {
    if (!draft?.name.trim()) {
      setError("Give the theme a name");
      return;
    }
    const theme = normalizeCustomTheme(draft, APPEARANCE_THEME_IDS);
    if (!theme) {
      setError("Use valid hex colors and keep the theme under 256 KB");
      return;
    }
    setPreferences((current) => ({
      ...current,
      source: "palot",
      mode: theme.scheme,
      customThemes: [...current.customThemes.filter((item) => item.id !== theme.id), theme],
      ...(theme.scheme === "light"
        ? { lightTheme: theme.id, lightCodeTheme: "follow" }
        : { darkTheme: theme.id, darkCodeTheme: "follow" }),
    }));
    setDraft(null);
  };
  const remove = (theme: CustomTheme) => {
    setPreferences((current) => ({
      ...current,
      customThemes: current.customThemes.filter((item) => item.id !== theme.id),
      lightTheme: current.lightTheme === theme.id ? "palot" : current.lightTheme,
      darkTheme: current.darkTheme === theme.id ? "palot" : current.darkTheme,
    }));
    setDeleting(null);
  };
  return (
    <SettingsSection
      title="Custom themes"
      description="Create a palette or import a self-contained VS Code theme. Saved on this device."
      action={
        <>
          <Button size="sm" variant="outline" disabled={!canCreate} onClick={create}>
            Create theme
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canCreate}
            onClick={() => {
              setSource("");
              setError(null);
              setImporting(true);
            }}
          >
            Import theme
          </Button>
        </>
      }
    >
      <SettingsGroup>
        {!preferences.customThemes.length ? (
          <SettingsRow
            title="Your own colors"
            description="Duplicate the current theme, then edit its colors with a live preview."
          />
        ) : null}
        {preferences.customThemes.map((theme) => (
          <SettingsRow
            key={theme.id}
            title={theme.name}
            description={`${theme.scheme === "light" ? "Light" : "Dark"} palette`}
            control={
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setPreferences((current) => ({
                      ...current,
                      source: "palot",
                      mode: theme.scheme,
                      ...(theme.scheme === "light"
                        ? { lightTheme: theme.id }
                        : { darkTheme: theme.id }),
                    }))
                  }
                >
                  Use for {theme.scheme}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setError(null);
                    setDraft(structuredClone(theme));
                  }}
                >
                  Edit {theme.name}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setExported(exportCustomTheme(theme))}
                >
                  Export {theme.name}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onBlur={() => setDeleting(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setDeleting(null);
                  }}
                  onClick={() => (deleting === theme.id ? remove(theme) : setDeleting(theme.id))}
                >
                  {deleting === theme.id ? `Confirm delete ${theme.name}` : `Delete ${theme.name}`}
                </Button>
              </div>
            }
          />
        ))}
      </SettingsGroup>
      <SettingsNotice open={!canCreate} title="Theme limit reached">
        Delete a custom theme before adding another (32 maximum).
      </SettingsNotice>
      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import theme</DialogTitle>
            <DialogDescription>
              Paste VS Code or exported Palot JSON. Comments and trailing commas are supported.
              Maximum 256 KB.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Theme JSON"
            value={source}
            maxLength={MAX_THEME_BYTES}
            className="min-h-48 font-mono"
            onChange={(event) => setSource(event.target.value)}
          />
          <SettingsNotice open={Boolean(error)} title="Could not import theme" status="error">
            {error}
          </SettingsNotice>
          <Button
            onClick={() => {
              try {
                setDraft(importCustomTheme(source, `custom:${crypto.randomUUID()}`));
                setImporting(false);
                setError(null);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Invalid theme");
              }
            }}
          >
            Review imported theme
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto @container sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Theme editor</DialogTitle>
            <DialogDescription>
              Changes stay in this preview until you save. This palette is for {draft?.scheme} mode.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <>
              <label className="space-y-2 text-compact">
                Theme name
                <Input
                  aria-label="Theme name"
                  maxLength={80}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <ThemePreview theme={draft} />
              <div className="grid gap-3 @xl:grid-cols-2">
                {ROLES.map(([role, label]) => (
                  <ColorField
                    key={role}
                    label={label}
                    value={
                      draft.colors[role] ?? customThemeVariant(draft).palette[role] ?? "#808080"
                    }
                    onChange={(value) =>
                      setDraft({ ...draft, colors: { ...draft.colors, [role]: value } })
                    }
                  />
                ))}
              </div>
              <SettingsNotice open={Boolean(error)} title="Could not save theme" status="error">
                {error}
              </SettingsNotice>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button onClick={save}>Save and apply theme</Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={exported !== null}
        onOpenChange={(open) => {
          if (!open) setExported(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export theme</DialogTitle>
            <DialogDescription>
              Copy this JSON into a .json file. Import it to restore the palette and syntax colors.
            </DialogDescription>
          </DialogHeader>
          <CopyField value={exported ?? ""} label="Theme JSON" />
          <Textarea
            aria-label="Exported theme JSON"
            readOnly
            value={exported ?? ""}
            className="min-h-48 font-mono"
          />
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  const [text, setText] = useState(() => pickerColor(value, true));
  return (
    <label className="flex min-w-0 items-center gap-3 text-compact">
      <input
        type="color"
        aria-label={`${label} color picker`}
        value={pickerColor(value)}
        className="size-8 shrink-0 cursor-pointer rounded border border-input bg-transparent"
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value);
        }}
      />
      <span className="flex-1">{label}</span>
      <Input
        aria-label={`${label} color`}
        value={text}
        className="w-28 font-mono"
        aria-invalid={!isThemeColor(text)}
        onChange={(event) => {
          setText(event.target.value);
          if (isThemeColor(event.target.value)) onChange(event.target.value);
        }}
        onBlur={() => setText(pickerColor(value, true))}
      />
    </label>
  );
}

function ThemePreview({ theme }: { theme: CustomTheme }) {
  const { palette } = customThemeVariant(theme);
  const style = Object.fromEntries(
    Object.entries(palette).map(([key, value]) => [
      `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      value,
    ]),
  ) as CSSProperties;
  return (
    <section
      aria-label="Theme live preview"
      style={style}
      className="overflow-hidden rounded-lg border border-border bg-background text-foreground"
    >
      <div className="grid grid-cols-[1fr_3fr]">
        <aside className="min-w-0 border-r border-border bg-sidebar p-4 text-sidebar-foreground wrap-break-word">
          <p className="text-compact font-semibold">Workspace</p>
          <p className="mt-3 text-compact">My task</p>
        </aside>
        <div className="space-y-3 p-4">
          <p className="text-sm font-semibold">Make it yours</p>
          <p className="text-compact text-muted-foreground">A quiet workspace, in your colors.</p>
          <div className="flex flex-wrap gap-3 text-compact">
            <span className="text-success">Ready</span>
            <span className="text-warning">Warning</span>
            <span className="text-destructive">Error</span>
          </div>
          <Button size="sm">Continue</Button>
        </div>
      </div>
    </section>
  );
}
