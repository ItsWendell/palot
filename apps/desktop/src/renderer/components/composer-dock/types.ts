/**
 * Plain data for the composer dock's views. Feature code maps OpenCode requests, the plan,
 * goal, background work, undo and voice state into these; the views never see OpenCode.
 */

interface DiffLineView {
  type: "add" | "del" | "ctx";
  text: string;
}

export interface PermissionRequestView {
  kind: "permission";
  id: string;
  /** Picks the icon. */
  permission: "shell" | "edit" | "network" | "other";
  title: string;
  /** The command, path or host, shown monospaced. */
  subject: string;
  reason?: string;
  /** What "Always allow" saves; absent when OpenCode gave no reusable pattern. */
  rule?: string;
  diff?: readonly DiffLineView[];
  /** The subagent that asked, such as "explore". */
  source?: string;
}

interface QuestionOptionView {
  label: string;
  description?: string;
}

interface QuestionStepView {
  prompt: string;
  multiple: boolean;
  options: readonly QuestionOptionView[];
  /** Whether a typed answer is accepted besides the options. */
  custom: boolean;
}

export interface QuestionRequestView {
  kind: "question";
  id: string;
  steps: readonly QuestionStepView[];
  source?: string;
}

type FormFieldView =
  | { id: string; type: "text"; label: string; placeholder?: string; required?: boolean }
  | { id: string; type: "select"; label: string; options: readonly string[]; required?: boolean }
  | { id: string; type: "checkbox"; label: string };

export interface FormRequestView {
  kind: "form";
  id: string;
  title: string;
  /** The MCP server that asked. */
  server?: string;
  description?: string;
  fields: readonly FormFieldView[];
  source?: string;
}

export interface GuestRequestView {
  kind: "guest";
  id: string;
  from: string;
  verified: boolean;
  text: string;
}

export type RequestView =
  | PermissionRequestView
  | QuestionRequestView
  | FormRequestView
  | GuestRequestView;

/** Everything picked or typed for a question, per step. */
export interface QuestionAnswer {
  step: number;
  /** Picked option labels, per step. */
  choices: readonly (readonly string[])[];
  /** Typed answers, per step. */
  texts: readonly string[];
}

export type FormValues = Readonly<Record<string, string | boolean>>;

export interface PlanItemView {
  /** What the step is ("Run the e2e suite"). */
  text: string;
  /** The same step while it runs ("Running the e2e suite"); falls back to `text`. */
  active?: string;
  status: "done" | "running" | "pending" | "cancelled";
}

export interface GoalView {
  objective: string;
  status: "active" | "paused" | "complete";
  round: number;
  rounds: number;
  /** Why it paused, or the reviewer's latest reason. */
  reason?: string;
}

export interface BackgroundItemView {
  id: string;
  kind: "agent" | "command" | "terminal";
  label: string;
  /** Formatted by the caller ("42s", "1m 5s"). */
  elapsed?: string;
  finished?: boolean;
}

export interface VoiceView {
  phase: "connecting" | "listening" | "thinking" | "speaking";
  micMuted: boolean;
  /** The voice is muted and captions show instead. */
  outputMuted?: boolean;
  /** The call is still starting; End cancels it. */
  starting?: boolean;
  ending?: boolean;
  /** Overrides the phase's own words ("Ending voice chat…"). */
  status?: string;
  /** Formatted by the caller. */
  elapsed?: string;
  /** The latest caption. */
  caption?: string;
}
