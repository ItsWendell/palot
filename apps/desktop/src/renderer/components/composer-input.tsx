import { lazy, Suspense, type ComponentProps, type Ref } from "react";
import type { ComposerDraft } from "../lib/composer-draft";
import type { ReviewComment } from "../lib/review-comments";
import { InputGroupTextarea } from "./ui/input-group";

export interface ComposerInputHandle {
  focus(): void;
  setSelectionRange(start: number, end: number): void;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

export interface ComposerInputProps extends Omit<
  ComponentProps<"textarea">,
  | "ref"
  | "value"
  | "onChange"
  | "onSelect"
  | "onClick"
  | "onCompositionEnd"
  | "onKeyDown"
  | "onCompositionStart"
  | "onPaste"
> {
  ref?: Ref<ComposerInputHandle>;
  draft: ComposerDraft;
  rich: boolean;
  comments: ReviewComment[];
  onDraftChange(draft: ComposerDraft): void;
  onCommentsChange(comments: ReviewComment[]): void;
  onValueChange(text: string): void;
  onSelectionChange(selection: { start: number; end: number }): void;
  onKeyDown(event: React.KeyboardEvent<HTMLElement>): void;
  onCompositionEnd(): void;
  onCompositionStart(): void;
  onPaste(event: React.ClipboardEvent<HTMLElement>): void;
}

const RichComposerInput = lazy(() => import("./composer-rich-input"));

export function ComposerInput(props: ComposerInputProps) {
  const {
    rich,
    draft,
    comments: _comments,
    onCommentsChange: _onCommentsChange,
    onDraftChange: _onDraftChange,
    onValueChange,
    onSelectionChange,
    onCompositionEnd,
    ref,
    ...textareaProps
  } = props;
  const plain = (
    <InputGroupTextarea
      {...textareaProps}
      ref={ref as Ref<HTMLTextAreaElement>}
      value={draft.text}
      onChange={(event) => {
        onValueChange(event.target.value);
        onSelectionChange({ start: event.target.selectionStart, end: event.target.selectionEnd });
      }}
      onSelect={(event) =>
        onSelectionChange({
          start: event.currentTarget.selectionStart,
          end: event.currentTarget.selectionEnd,
        })
      }
      onCompositionEnd={(event) => {
        onCompositionEnd();
        onSelectionChange({
          start: event.currentTarget.selectionStart,
          end: event.currentTarget.selectionEnd,
        });
      }}
    />
  );
  return rich ? (
    <Suspense fallback={plain}>
      <RichComposerInput {...props} />
    </Suspense>
  ) : (
    plain
  );
}
