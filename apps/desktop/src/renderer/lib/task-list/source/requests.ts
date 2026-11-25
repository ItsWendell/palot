/** OpenCode's pending permissions and forms, as the task list's requests. */

import type { PalotSession, SessionRequestSnapshot } from "../../../../shared";
import { familyRequestViews, type OwnedPendingRequestView } from "../../session-family-requests";
import type { TaskRequest } from "../types";

export interface OwnedTaskRequest {
  request: TaskRequest;
  /** The session that asked: the task itself or one of its subagents. Replies go there. */
  ownerSessionID: string;
}

/** Lines for the row; long commands keep their first line, the full text is `detail`. */
function firstLine(value: string): string {
  return value.split("\n", 1)[0]!.trim();
}

/**
 * Who asked, for "From explore subagent". Null when the task itself asked; an empty string for
 * a subagent without an agent name ("From a subagent").
 */
function requestSource(
  view: OwnedPendingRequestView,
  rootID: string,
  family: readonly PalotSession[],
): string | null {
  if (view.sessionID === rootID) return null;
  const owner = family.find((session) => session.id === view.sessionID);
  return owner?.agent?.trim() ?? "";
}

/**
 * A question the row can answer with one press: one single-choice question in a form of one
 * field, so the answer maps to that field. Anything else (several questions, several fields,
 * multiple choice, a plain form) is a question without options, and the row offers "Open task"
 * only.
 */
function questionRequest(view: OwnedPendingRequestView) {
  const only = view.questions.length === 1 ? view.questions[0]! : null;
  const answerable =
    view.type === "question" &&
    only !== null &&
    !only.multiple &&
    view.fields.length === 1 &&
    only.options.length > 0;
  return {
    question: only?.question.trim() || view.title.trim() || "Waiting for your answer",
    options: answerable ? only.options.map((option) => option.label) : [],
  };
}

/**
 * Every pending request of a task and its subagents, oldest first. `firstSeen` supplies an
 * arrival time for a request OpenCode did not date, and must return the same value for the
 * same request every time.
 */
export function taskRequests(input: {
  rootID: string;
  family: readonly PalotSession[];
  requests: ReadonlyMap<string, SessionRequestSnapshot>;
  firstSeen(key: string): number;
}): OwnedTaskRequest[] {
  const { rootID, family } = input;
  const snapshots = new Map<string, SessionRequestSnapshot>();
  for (const session of family) {
    const snapshot = input.requests.get(session.id);
    if (snapshot) snapshots.set(session.id, snapshot);
  }
  if (snapshots.size === 0) return [];
  const views = familyRequestViews(
    family.map(({ id, parentID, title }) => ({ id, parentID, title })),
    snapshots,
  );
  return views.map((view) => {
    const arrivedAt =
      view.createdAt ?? input.firstSeen(`${view.sessionID}:${view.type}:${view.id}`);
    const from = requestSource(view, rootID, family);
    if (view.type === "permission") {
      const resources = view.resources.map((resource) => resource.trim()).filter(Boolean);
      const summary = firstLine(resources[0] ?? "") || view.title || "Permission needed";
      return {
        ownerSessionID: view.sessionID,
        request: {
          kind: "permission",
          id: view.id,
          arrivedAt,
          from,
          summary,
          detail: resources.join("\n") || view.detail?.trim() || summary,
          // Empty when OpenCode offers no rule to save; the row then offers no "Always".
          rule: view.savePatterns.join(", "),
        },
      };
    }
    return {
      ownerSessionID: view.sessionID,
      request: { kind: "question", id: view.id, arrivedAt, from, ...questionRequest(view) },
    };
  });
}

export function sameTaskRequest(left: TaskRequest, right: TaskRequest): boolean {
  if (
    left.kind !== right.kind ||
    left.id !== right.id ||
    left.arrivedAt !== right.arrivedAt ||
    left.from !== right.from
  )
    return false;
  if (left.kind === "permission" && right.kind === "permission")
    return (
      left.summary === right.summary && left.detail === right.detail && left.rule === right.rule
    );
  if (left.kind === "question" && right.kind === "question")
    return (
      left.question === right.question &&
      left.options.length === right.options.length &&
      left.options.every((option, index) => option === right.options[index])
    );
  return false;
}
