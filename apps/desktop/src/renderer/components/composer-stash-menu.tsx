import { Archive, Trash2 } from "lucide-react";
import { useState } from "react";
import { loadPromptStash, savePromptStash, type StashedPrompt } from "../lib/prompt-stash";
import { showErrorToast } from "../lib/toast-error";
import { formatShortcut, useShortcutKeys } from "../lib/keyboard-shortcuts";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function ComposerStashMenu({
  scope,
  disabled,
  canStash,
  onStash,
  onRestore,
}: {
  scope: string;
  disabled: boolean;
  canStash: boolean;
  onStash(): void;
  onRestore(entry: StashedPrompt): void;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<StashedPrompt[]>([]);
  const keys = useShortcutKeys("composer.stash");
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setEntries(loadPromptStash(scope));
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Prompt stash"
            title={`Prompt stash · ${formatShortcut(keys)}`}
            disabled={disabled}
          />
        }
      >
        <Archive aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          disabled={disabled || !canStash}
          onClick={() => {
            onStash();
            setEntries(loadPromptStash(scope));
          }}
        >
          Stash prompt{" "}
          <span className="ml-auto text-meta text-muted-foreground">{formatShortcut(keys)}</span>
        </Button>
        <div className="palot-native-scrollbar max-h-72 overflow-auto">
          {!entries.length ? (
            <p className="p-2 text-meta text-muted-foreground">
              No stashed prompts in this project
            </p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="flex items-center gap-1 rounded-md hover:bg-accent">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col gap-1 rounded-md p-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Restore ${entry.draft.text || "attached files"}`}
                  disabled={disabled}
                  onClick={() => {
                    onRestore(entry);
                    setOpen(false);
                  }}
                >
                  <span className="line-clamp-2 break-words">
                    {entry.draft.text || `${entry.files.length} attachments`}
                  </span>
                  <time
                    dateTime={new Date(entry.createdAt).toISOString()}
                    className="text-meta text-muted-foreground"
                  >
                    {new Date(entry.createdAt).toLocaleString()}
                  </time>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Delete stashed prompt"
                  onClick={() => {
                    try {
                      savePromptStash(
                        scope,
                        loadPromptStash(scope).filter((item) => item.id !== entry.id),
                      );
                      setEntries(loadPromptStash(scope));
                    } catch (error) {
                      showErrorToast("Could not delete stashed prompt", error);
                    }
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
