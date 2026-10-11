import { useAtom } from "jotai";
import { Columns2, Rows3 } from "lucide-react";
import {
  diffViewPreferencesAtom,
  type DiffInlineChanges,
  type DiffViewPreferences,
} from "../../atoms/diff-preferences";
import type { DiffLayout, DiffLayoutPreference } from "../../lib/diff-layout";
import { formatShortcut, shortcutKeys } from "../../lib/keyboard-shortcuts";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export function useDiffViewPreferences() {
  const [preferences, setPreferences] = useAtom(diffViewPreferencesAtom);
  const update = (patch: Partial<DiffViewPreferences>) =>
    setPreferences((current) => ({ ...current, ...patch }));
  return [preferences, update] as const;
}

const LAYOUTS: ReadonlyArray<{ value: DiffLayoutPreference; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "split", label: "Split" },
  { value: "unified", label: "Unified" },
];

const INLINE_CHANGES: ReadonlyArray<{ value: DiffInlineChanges; label: string }> = [
  { value: "word", label: "Words" },
  { value: "char", label: "Characters" },
  { value: "none", label: "Off" },
];

/**
 * Diff layout, inline highlighting, and whitespace choices in one compact toolbar
 * menu. The trigger icon shows the layout currently in effect.
 */
export function DiffViewOptionsMenu({
  layout,
  onFind,
  hideWhitespaceAvailable = true,
}: {
  /** Layout in effect, after Auto resolves. */
  layout: DiffLayout;
  /** Opens Find in diff; omitted where the surface has no find. */
  onFind?(): void;
  hideWhitespaceAvailable?: boolean;
}) {
  const [preferences, update] = useDiffViewPreferences();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Diff view options" />
        }
      >
        {layout === "split" ? <Columns2 aria-hidden="true" /> : <Rows3 aria-hidden="true" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Layout</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preferences.layout}
            onValueChange={(value) => {
              const next = LAYOUTS.find((option) => option.value === value);
              if (next) update({ layout: next.value });
            }}
          >
            {LAYOUTS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
                {option.value === "auto" && preferences.layout === "auto" ? (
                  <span className="ml-auto text-muted-foreground">
                    {layout === "split" ? "Split" : "Unified"}
                  </span>
                ) : null}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Highlight changes within lines</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preferences.inline}
            onValueChange={(value) => {
              const next = INLINE_CHANGES.find((option) => option.value === value);
              if (next) update({ inline: next.value });
            }}
          >
            {INLINE_CHANGES.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {hideWhitespaceAvailable ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={preferences.hideWhitespace}
              onCheckedChange={(checked) => update({ hideWhitespace: checked })}
            >
              Hide whitespace changes
            </DropdownMenuCheckboxItem>
          </>
        ) : null}
        {onFind ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onFind}>
              Find in diff
              <DropdownMenuShortcut>
                {formatShortcut(shortcutKeys("task.find"))}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
