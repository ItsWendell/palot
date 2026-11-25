import { useAtom } from "jotai";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  MAX_REVIEW_INSTRUCTIONS,
  reviewInstructionProblem,
  reviewInstructionsAtom,
  type SavedReviewInstruction,
} from "../../atoms/review-instructions";
import { SettingsGroup, SettingsRow, SettingsSection } from "../settings-layout";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

type Editing = { id: string | null; name: string; instructions: string };

/** Saved `/review` instructions: listed in the review picker after the built-in targets. */
export function ReviewInstructionsSettings() {
  const [saved, setSaved] = useAtom(reviewInstructionsAtom);
  const [editing, setEditing] = useState<Editing | null>(null);
  const others = editing ? saved.filter((entry) => entry.id !== editing.id) : saved;
  const problem = editing
    ? reviewInstructionProblem(editing.name, editing.instructions, others)
    : null;
  const save = () => {
    if (!editing || problem) return;
    const entry: SavedReviewInstruction = {
      id: editing.id ?? crypto.randomUUID(),
      name: editing.name.trim(),
      instructions: editing.instructions.trim(),
    };
    setSaved((current) =>
      editing.id
        ? current.map((candidate) => (candidate.id === editing.id ? entry : candidate))
        : [...current, entry],
    );
    setEditing(null);
  };
  return (
    <SettingsSection
      title="Review instructions"
      description="Saved instructions for /review, such as a security pass. Typing /review in the composer lists them after uncommitted changes, the base branch and a commit; picking one runs the review in the task."
      action={
        editing === null && saved.length < MAX_REVIEW_INSTRUCTIONS ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditing({ id: null, name: "", instructions: "" })}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add instructions
          </Button>
        ) : null
      }
    >
      <SettingsGroup>
        {saved.length === 0 && editing === null ? (
          <SettingsRow
            title="No saved instructions"
            description="Add one to review the same way every time."
          />
        ) : null}
        {saved.map((entry) =>
          editing?.id === entry.id ? null : (
            <SettingsRow
              key={entry.id}
              title={entry.name}
              description={<span className="line-clamp-2">{entry.instructions}</span>}
              actions={
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Edit ${entry.name}`}
                    disabled={editing !== null}
                    onClick={() =>
                      setEditing({
                        id: entry.id,
                        name: entry.name,
                        instructions: entry.instructions,
                      })
                    }
                  >
                    <Pencil data-icon="inline-start" aria-hidden="true" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${entry.name}`}
                    disabled={editing !== null}
                    onClick={() =>
                      setSaved((current) =>
                        current.filter((candidate) => candidate.id !== entry.id),
                      )
                    }
                  >
                    <Trash2 data-icon="inline-start" aria-hidden="true" />
                    Remove
                  </Button>
                </>
              }
            />
          ),
        )}
        {editing ? (
          <form
            aria-label={editing.id ? "Edit review instructions" : "New review instructions"}
            className="flex flex-col gap-3 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <Input
              aria-label="Name"
              placeholder="Security pass"
              autoFocus
              value={editing.name}
              onChange={(event) => setEditing({ ...editing, name: event.currentTarget.value })}
            />
            <Textarea
              aria-label="Instructions"
              placeholder="Review the uncommitted changes for injection, auth bypass and secrets in logs."
              rows={4}
              value={editing.instructions}
              onChange={(event) =>
                setEditing({ ...editing, instructions: event.currentTarget.value })
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 min-w-0 flex-1 text-meta text-muted-foreground" aria-live="polite">
                {problem && (editing.name || editing.instructions)
                  ? problem
                  : "The text goes after /review, so it can name what to review too."}
              </p>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={problem !== null}>
                Save
              </Button>
            </div>
          </form>
        ) : null}
      </SettingsGroup>
    </SettingsSection>
  );
}
