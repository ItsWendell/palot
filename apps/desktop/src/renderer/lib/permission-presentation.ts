import type { PermissionRequest } from "@opencode/client";
import type { PalotMessage } from "../../shared";
import { palotToolName, type PalotToolName } from "../../shared/palot-tools-contract";

export interface PermissionPreview {
  label: string;
  text: string;
  file?: string;
  patch?: string;
  truncated: boolean;
  /** What the action is about, shown without expanding the details. */
  subject?: string;
  /** The scheduled task an update or delete targets; the card shows its name. */
  automationID?: string;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
const MAX_PREVIEW_LENGTH = 24_000;

const PALOT_TOOL_TITLES: Partial<Record<PalotToolName, string>> = {
  schedule_task: "Schedule a task",
  update_automation: "Change a scheduled task",
  delete_automation: "Delete a scheduled task",
};

/** A permission card's heading: what the agent wants to do. */
export function permissionTitle(action: string): string {
  const tool = palotToolName(action);
  if (tool) return PALOT_TOOL_TITLES[tool] ?? `Palot: ${tool.replaceAll("_", " ")}`;
  return action || "Permission needed";
}

/** Palot tool arguments as labeled lines, in the order a person reads them. */
function palotToolDetails(tool: PalotToolName, input: Record<string, unknown>): string {
  const fields: Array<[string, unknown]> = [
    ["Name", input.name],
    ["When", input.at],
    ["Repeats", input.rrule === "" ? "No longer repeats" : input.rrule],
    ["Time zone", input.timezone],
    [
      "Runs in",
      input.target === "new_task"
        ? `A new task${input.workspace === "checkout" ? " in the project checkout" : " in a new worktree"}`
        : tool === "schedule_task"
          ? "This task"
          : undefined,
    ],
    ["Status", input.status],
    ["Prompt", input.prompt],
    ["ID", input.automationId],
  ];
  return fields
    .flatMap(([label, value]) =>
      typeof value === "string" && value !== "" ? [`${label}: ${value}`] : [],
    )
    .join("\n");
}

export function permissionPreview(
  request: PermissionRequest,
  messages: readonly PalotMessage[],
): PermissionPreview {
  const message = messages.find(
    (message) => message.id === request.source?.messageID && message.type === "assistant",
  );
  const part = message?.content.find(
    (part) => part.type === "tool" && part.id === request.source?.id,
  );
  const state = record(part?.state);
  const input = state.status === "streaming" ? {} : record(state.input);
  const metadata = {
    ...(state.status === "streaming" ? {} : record(state.metadata)),
    ...record(request.metadata),
  };
  const path = text(input.path) || text(input.filePath) || request.resources[0] || "";
  const action = request.action;
  let label = action;
  let body = "";
  let patch = "";
  let subject: string | undefined;
  let automationID: string | undefined;
  if (["shell", "bash"].includes(action)) {
    label = "Command";
    body = text(input.command);
  } else if (["edit", "write", "apply_patch"].includes(action)) {
    label =
      Array.isArray(metadata.files) && metadata.files.length > 1
        ? `Proposed edit (first of ${metadata.files.length} files)`
        : "Proposed edit";
    const first = record(Array.isArray(metadata.files) ? metadata.files[0] : undefined);
    patch = text(first.patch) || text(first.diff) || text(metadata.diff) || text(input.patchText);
    body = patch || text(input.content) || "No edit preview was provided.";
  } else if (["read", "list", "external_directory"].includes(action)) {
    label = "Path";
    body = path;
  } else if (["glob", "grep"].includes(action)) {
    label = "Pattern";
    body = text(input.pattern);
  } else if (["subagent", "task"].includes(action)) {
    label = "Subagent request";
    body = [
      text(input.agent) || text(input.subagent_type),
      text(input.description),
      text(input.prompt),
    ]
      .filter(Boolean)
      .join("\n");
  } else if (action === "webfetch") {
    label = "URL";
    body = text(input.url) || text(metadata.url);
  } else if (action === "websearch") {
    label = "Search query";
    body = text(input.query) || text(metadata.query);
  } else if (palotToolName(action)) {
    const args = { ...input, ...record(metadata.input) };
    label = "Details";
    body = palotToolDetails(palotToolName(action)!, args);
    if (text(args.automationId)) automationID = text(args.automationId);
    else if (text(args.name)) subject = text(args.name);
  } else if (action === "lsp") {
    label = "Language server request";
    body = [text(input.operation), path].filter(Boolean).join("\n");
  }
  body ||=
    request.resources.join("\n") || request.message || "OpenCode did not provide further details.";
  return {
    label,
    text: body.slice(0, MAX_PREVIEW_LENGTH),
    truncated: body.length > MAX_PREVIEW_LENGTH,
    ...(subject ? { subject } : {}),
    ...(automationID ? { automationID } : {}),
    ...(patch && patch.length <= MAX_PREVIEW_LENGTH
      ? { file: path || "Proposed changes", patch }
      : {}),
  };
}
