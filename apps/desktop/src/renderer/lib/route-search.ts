export interface SessionRouteSearch {
  profileID?: string;
  focus?: "request";
  requestID?: string;
  requestType?: "permission" | "form" | "question" | "input";
}

export interface ProjectRouteSearch {
  profileID?: string;
  projectID?: string;
}

export interface ChangesRouteSearch {
  file?: string;
  mode?: "working" | "branch";
}

export interface AutomationRouteSearch {
  automationID?: string;
  runID?: string;
  mode?: "create";
  sessionID?: string;
}

export const USAGE_RANGE_OPTIONS = [1, 7, 30, 90] as const;
export type UsageRangeDays = (typeof USAGE_RANGE_OPTIONS)[number];

export interface UsageRouteSearch {
  days: UsageRangeDays;
  projectID?: string;
}

function optionalIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : undefined;
}

export function validateProjectSearch(search: Record<string, unknown>): ProjectRouteSearch {
  return { projectID: optionalIdentifier(search.projectID), ...validateConnectionSearch(search) };
}

export function validateConnectionSearch(search: Record<string, unknown>): { profileID?: string } {
  const profileID = optionalIdentifier(search.profileID);
  return profileID ? { profileID } : {};
}

export function validateSessionSearch(search: Record<string, unknown>): SessionRouteSearch {
  const requestID = optionalIdentifier(search.requestID);
  const requestType = ["permission", "form", "question", "input"].includes(
    String(search.requestType),
  )
    ? (search.requestType as SessionRouteSearch["requestType"])
    : undefined;
  return search.focus === "request" && requestID && requestType
    ? { focus: "request", requestID, requestType, ...validateConnectionSearch(search) }
    : validateConnectionSearch(search);
}

export function validateChangesSearch(search: Record<string, unknown>): ChangesRouteSearch {
  const file =
    typeof search.file === "string" && search.file.length <= 32_768 ? search.file : undefined;
  const mode = search.mode === "branch" ? "branch" : "working";
  return { file, mode };
}

export function validateAutomationSearch(search: Record<string, unknown>): AutomationRouteSearch {
  const automationID = optionalIdentifier(search.automationID);
  const runID = optionalIdentifier(search.runID);
  const sessionID = optionalIdentifier(search.sessionID);
  const mode = search.mode === "create" ? "create" : undefined;
  return {
    ...(automationID ? { automationID } : {}),
    ...(runID ? { runID } : {}),
    ...(mode ? { mode } : {}),
    ...(sessionID ? { sessionID } : {}),
  };
}

export function validateUsageSearch(search: Record<string, unknown>): UsageRouteSearch {
  const requestedDays = Number(search.days);
  const days = isUsageRangeDays(requestedDays) ? requestedDays : 7;
  const projectID = optionalIdentifier(search.projectID);
  return { days, ...(projectID ? { projectID } : {}) };
}

export function isUsageRangeDays(value: number): value is UsageRangeDays {
  return USAGE_RANGE_OPTIONS.some((days) => days === value);
}
