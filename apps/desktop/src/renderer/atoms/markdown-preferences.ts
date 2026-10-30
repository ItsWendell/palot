import { persistedAtom } from "./persisted";

// Markdown blocks remount when streaming settles and when virtualized turns return.
export const markdownCodeWrapAtom = persistedAtom({
  key: "markdown.code-wrap",
  initialValue: false,
  validate: (value): value is boolean => typeof value === "boolean",
});
