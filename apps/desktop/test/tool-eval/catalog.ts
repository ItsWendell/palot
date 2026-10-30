import type { ClientMcpTool } from "@opencode/client/mcp";
import { palotSchedulingState, palotTools } from "../../src/main/palot-tools/tools";

/** Real names, schemas and descriptions; eval handlers never touch the desktop or other tasks. */
export function evalTools(
  onCall: (name: string, args: Record<string, unknown>) => void,
): ClientMcpTool[] {
  const unavailable = () => {
    throw new Error("Eval must not execute production handlers");
  };
  return palotTools({
    profileID: "eval",
    withClient: unavailable,
    onEvent: () => () => {},
    automations: { load: unavailable, dispatch: unavailable },
    triage: { load: unavailable, dispatch: unavailable },
    onTriageChanged: unavailable,
    timezone: () => "UTC",
    now: Date.now,
    signal: new AbortController().signal,
    scheduling: palotSchedulingState(),
    askBeforeScheduling: () => false,
  }).map((tool) => ({
    ...tool,
    handler(args) {
      onCall(tool.name, args);
      const result =
        tool.name === "list_automations"
          ? { automations: [] }
          : tool.name === "list_tasks"
            ? { tasks: [{ taskId: "ses_eval_other", title: "Other fixture task", status: "idle" }] }
            : { recorded: true, dryRun: true };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  }));
}

export interface CatalogTool {
  path: string;
  description: string;
  properties?: Record<string, unknown>;
}

export function palotCatalog(): CatalogTool[] {
  return evalTools(() => {}).map((tool) => ({
    path: `palot.${tool.name}`,
    description: tool.description ?? "",
    properties: tool.inputSchema?.properties as Record<string, unknown>,
  }));
}

// Deliberately includes competing task, PR, scheduling and wait vocabulary, not just unrelated noise.
export const distractorCatalog: CatalogTool[] = [
  ...[
    "session_create",
    "session_list",
    "session_get",
    "session_rename",
    "session_prompt",
    "session_wait",
    "session_archive",
    "project_list",
    "file_read",
    "file_write",
    "shell",
    "worktree_create",
  ].map((name) => ({
    path: `opencode.${name}`,
    description: `OpenCode ${name.replaceAll("_", " ")}`,
  })),
  ...Object.entries({
    aws: [
      "instance",
      "bucket",
      "task",
      "job",
      "schedule",
      "alarm",
      "log",
      "queue",
      "cluster",
      "role",
    ],
    youtube: [
      "video",
      "channel",
      "comment",
      "playlist",
      "caption",
      "report",
      "subscription",
      "broadcast",
    ],
    linear: ["issue", "project", "comment", "cycle", "team", "label", "document", "workflow"],
    "horizon-game": ["world", "block", "inventory", "entity", "screen", "player", "item", "recipe"],
    github: [
      "pull_request",
      "branch",
      "check",
      "review",
      "comment",
      "repository",
      "release",
      "issue",
    ],
  }).flatMap(([namespace, resources]) =>
    resources.flatMap((resource) =>
      ["list", "get", "create", "update", "delete", "watch", "wait"].map((verb) => ({
        path: `emcee.${namespace}__${verb}_${resource}`,
        description: `${verb} ${resource.replaceAll("_", " ")} in ${namespace}`,
      })),
    ),
  ),
];

export const discoveryCases = [
  ["settle this session", "settle_task"],
  ["settle this task", "settle_task"],
  ["mark this task done for now", "settle_task"],
  ["move this task back to the inbox", "settle_task"],
  ["remind me tomorrow at 9", "schedule_task"],
  ["schedule a task tomorrow", "schedule_task"],
  ["run a weekly report", "schedule_task"],
  ["schedule a recurring follow up", "schedule_task"],
  ["list scheduled tasks", "list_automations"],
  ["what automations are scheduled", "list_automations"],
  ["pause an automation", "update_automation"],
  ["change the scheduled task prompt", "update_automation"],
  ["delete an automation", "delete_automation"],
  ["stop a scheduled task permanently", "delete_automation"],
  ["what tasks are running", "list_tasks"],
  ["list my tasks", "list_tasks"],
  ["read that task", "read_task"],
  ["show the latest messages of this task", "read_task"],
  ["wait for that task to finish", "wait_tasks"],
  ["wait until another task needs the user", "wait_tasks"],
  ["snooze until monday", "snooze_task"],
  ["snooze this session", "snooze_task"],
  ["pin this", "pin_task"],
  ["unpin this task", "pin_task"],
  ["archive it", "archive_task"],
  ["restore an archived task", "archive_task"],
  ["open a PR", "create_pull_request"],
  ["create a pull request", "create_pull_request"],
  ["link this pull request", "link_pull_request"],
  ["watch the PR", "watch_pull_request"],
  ["stop watching the PR", "unwatch_pull_request"],
  ["unwatch this pull request", "unwatch_pull_request"],
] as const;
