import { persistedAtom } from "./persisted";

/**
 * Named review instructions saved for `/review` ("Security pass"). OpenCode's `review` command
 * takes free text; picking one in the launcher runs `/review <instructions>` in the task.
 */
export interface SavedReviewInstruction {
  id: string;
  name: string;
  instructions: string;
}

export const MAX_REVIEW_INSTRUCTIONS = 50;
export const MAX_REVIEW_INSTRUCTION_NAME = 80;
export const MAX_REVIEW_INSTRUCTION_TEXT = 4_000;

function validInstruction(value: unknown): value is SavedReviewInstruction {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.instructions === "string" &&
    entry.name.trim().length > 0 &&
    entry.instructions.trim().length > 0
  );
}

export const reviewInstructionsAtom = persistedAtom<readonly SavedReviewInstruction[]>({
  key: "review.instructions",
  initialValue: [],
  validate: (value): value is readonly SavedReviewInstruction[] =>
    Array.isArray(value) &&
    value.length <= MAX_REVIEW_INSTRUCTIONS &&
    value.every(validInstruction),
});

/** Why a name and text can't be saved, or null when they can. */
export function reviewInstructionProblem(
  name: string,
  instructions: string,
  others: readonly SavedReviewInstruction[],
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the instructions a name.";
  if (trimmed.length > MAX_REVIEW_INSTRUCTION_NAME)
    return `Names are limited to ${MAX_REVIEW_INSTRUCTION_NAME} characters.`;
  if (others.some((entry) => entry.name.trim().toLowerCase() === trimmed.toLowerCase()))
    return "Another saved review already has this name.";
  if (!instructions.trim()) return "Write the instructions the reviewer should follow.";
  if (instructions.trim().length > MAX_REVIEW_INSTRUCTION_TEXT)
    return `Instructions are limited to ${MAX_REVIEW_INSTRUCTION_TEXT.toLocaleString()} characters.`;
  return null;
}
