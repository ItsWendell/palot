/**
 * The composer's editor element as tests and automation script it: a contenteditable that keeps
 * the scripting surface of the textarea it replaced (see `attachTextareaSurface` in
 * `components/composer-input.tsx`). It is not an `HTMLTextAreaElement`.
 */
export type ComposerEditorElement = HTMLElement & {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  readonly placeholder: string;
  setSelectionRange(start: number, end: number): void;
};
