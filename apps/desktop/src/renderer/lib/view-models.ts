import type {
  FormField,
  FormInfo,
  FormOption,
  PermissionRequest,
  SessionInboxUser,
} from "@opencode/client";
import type {
  JsonValue,
  PalotMessage,
  PalotMessageContent,
  PalotProject,
  PalotSession,
  SessionRequestSnapshot,
} from "../../shared";
import { permissionPreview, type PermissionPreview } from "./permission-presentation";

export interface ProjectGroup {
  project: PalotProject;
  sessions: PalotSession[];
}

export interface PendingRequestView {
  permissionPreview?: PermissionPreview;
  id: string;
  type: "permission" | "form" | "question" | "input";
  title: string;
  detail?: string;
  resources: string[];
  savePatterns: string[];
  questions: PendingQuestionView[];
  fields: PendingFormFieldView[];
  delivery?: "steer" | "queue";
  ownerMessageID?: string;
  createdAt?: number;
}

export interface PendingQuestionOptionView {
  label: string;
  description?: string;
  value?: string;
}

export interface PendingQuestionView {
  question: string;
  header: string;
  options: PendingQuestionOptionView[];
  multiple: boolean;
  custom: boolean;
}

export interface PendingFormFieldView {
  key: string;
  type: "string" | "number" | "integer" | "boolean" | "multiselect" | "external";
  title: string;
  description?: string;
  required: boolean;
  placeholder?: string;
  format?: "email" | "uri" | "date" | "date-time";
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  options: PendingQuestionOptionView[];
  custom: boolean;
  defaultValue?: string | number | boolean | string[];
  url?: string;
  when: Array<{ key: string; op: "eq" | "neq"; value: string | number | boolean }>;
}

function object(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function text(value: JsonValue | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function groupSessions(projects: PalotProject[], sessions: PalotSession[]): ProjectGroup[] {
  const roots = sessions.filter((session) => !session.parentID);
  const visible = visibleProjects(projects);
  const projectByID = new Map(projects.map((project) => [project.id, project]));
  const visibleByLocation = new Map(visible.map((project) => [projectLocation(project), project]));
  const byProject = new Map<string, PalotSession[]>();
  for (const session of roots) {
    const source = projectByID.get(session.projectID);
    const project = source ? visibleByLocation.get(projectLocation(source)) : undefined;
    if (!project) continue;
    const list = byProject.get(project.id);
    if (list) list.push(session);
    else byProject.set(project.id, [session]);
  }
  return visible
    .map((project) => ({
      project,
      sessions: (byProject.get(project.id) ?? []).toSorted((a, b) => b.updatedAt - a.updatedAt),
    }))
    .toSorted((left, right) => {
      const leftActivity = left.sessions[0]?.updatedAt;
      const rightActivity = right.sessions[0]?.updatedAt;
      if (leftActivity !== undefined || rightActivity !== undefined) {
        if (leftActivity === undefined) return 1;
        if (rightActivity === undefined) return -1;
        if (leftActivity !== rightActivity) return rightActivity - leftActivity;
      }
      return projectName(left.project).localeCompare(projectName(right.project));
    });
}

export function orderProjects(projects: PalotProject[], sessions: PalotSession[]): PalotProject[] {
  return groupSessions(projects, sessions).map(({ project }) => project);
}

export function visibleProjects(projects: PalotProject[]): PalotProject[] {
  const byLocation = new Map<string, PalotProject>();
  for (const project of projects) {
    const location = projectLocation(project);
    const current = byLocation.get(location);
    const projectIsGlobal = project.id === "global";
    const currentIsGlobal = current?.id === "global";
    if (
      !current ||
      (currentIsGlobal && !projectIsGlobal) ||
      (currentIsGlobal === projectIsGlobal && (project.updatedAt ?? 0) > (current.updatedAt ?? 0))
    ) {
      byLocation.set(location, project);
    }
  }
  return [...byLocation.values()];
}

export function projectForSession(
  projects: PalotProject[],
  session: Pick<PalotSession, "projectID" | "location">,
): PalotProject | undefined {
  const source = projects.find((project) => project.id === session.projectID);
  if (!source) return undefined;
  const visible = visibleProjects(projects);
  if (source.id === "global") {
    const repository = visible
      .filter((project) => {
        if (project.id === "global") return false;
        const location = projectLocation(project);
        return (
          session.location.directory === location ||
          session.location.directory.startsWith(`${location}/`)
        );
      })
      .toSorted((a, b) => projectLocation(b).length - projectLocation(a).length)[0];
    if (repository) return repository;
  }
  const location = projectLocation(source);
  return visible.find((project) => projectLocation(project) === location);
}

export function selectRecentSessions(
  sessions: PalotSession[],
  activeSessionIDs: ReadonlySet<string>,
  limit = 5,
): PalotSession[] {
  const roots = sessions.filter((session) => !session.parentID);
  const active = roots
    .filter((session) => activeSessionIDs.has(session.id))
    .toSorted((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const recent = roots
    .filter((session) => !activeSessionIDs.has(session.id))
    .toSorted((a, b) => sessionActivityAt(b) - sessionActivityAt(a) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit - active.length));
  return [...active, ...recent];
}

export function projectLocation(project: PalotProject): string {
  return project.canonical || project.sandboxes[0] || "";
}

export function sessionIsAdditionalCheckout(
  session: PalotSession,
  project?: PalotProject,
): boolean {
  return project
    ? session.location.directory !== projectLocation(project)
    : Boolean(session.location.workspaceID);
}

export function projectName(project: PalotProject): string {
  if (project.id === "global" || project.canonical === "/") return "Global";
  return project.name?.trim() || project.canonical.split("/").filter(Boolean).at(-1) || "Project";
}

export function messageText(message: PalotMessage, part?: PalotMessageContent): string {
  return part?.text ?? message.text ?? "";
}

export function messageRole(message: PalotMessage): "user" | "assistant" {
  return message.type === "user" ? "user" : "assistant";
}

export function isTool(part: PalotMessageContent): boolean {
  return part.type === "tool" || part.type === "tool-invocation" || part.type === "tool-call";
}

function ownerMessageID(metadata: Record<string, JsonValue> | undefined): string | undefined {
  const value = object(metadata);
  return text(object(value.tool).messageID) || text(value.messageID) || undefined;
}

function permissionView(value: PermissionRequest, index: number): PendingRequestView {
  return {
    id: value.id || `permission-${index}`,
    type: "permission",
    title: value.action || "Permission needed",
    detail: value.message,
    resources: [...value.resources],
    savePatterns: [...(value.save ?? [])],
    questions: [],
    fields: [],
    delivery: undefined,
    ownerMessageID: value.source?.messageID ?? ownerMessageID(value.metadata),
  };
}

function optionViews(value: FormOption[] | undefined): PendingQuestionOptionView[] {
  return (value ?? []).map((option) => ({
    label: option.label,
    description: option.description,
    value: option.value,
  }));
}

function questionView(field: PendingFormFieldView): PendingQuestionView {
  return {
    question: field.description ?? field.title,
    header: field.title,
    options: field.options.map(({ label, description }) => ({ label, description })),
    multiple: field.type === "multiselect",
    custom: field.custom,
  };
}

function finiteNumber(value: number | string | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formFieldView(field: FormField): PendingFormFieldView {
  const base = {
    key: field.key,
    type: field.type,
    title: field.title ?? field.key,
    description: field.description,
    required: "required" in field && field.required === true,
    options: "options" in field ? optionViews(field.options) : [],
    custom: "custom" in field && field.custom === true,
    when:
      "when" in field
        ? (field.when ?? []).map((condition) => ({
            key: condition.key,
            op: condition.op,
            value: condition.value,
          }))
        : [],
  };
  switch (field.type) {
    case "string":
      return {
        ...base,
        type: field.type,
        placeholder: field.placeholder,
        format: field.format,
        minLength: field.minLength,
        maxLength: field.maxLength,
        pattern: field.pattern,
        defaultValue: field.default,
      };
    case "number":
    case "integer":
      return {
        ...base,
        type: field.type,
        minimum: finiteNumber(field.minimum),
        maximum: finiteNumber(field.maximum),
        defaultValue: field.default,
      };
    case "boolean":
      return { ...base, type: field.type, defaultValue: field.default };
    case "multiselect":
      return {
        ...base,
        type: field.type,
        minItems: field.minItems,
        maxItems: field.maxItems,
        defaultValue: field.default,
      };
    case "external":
      return { ...base, type: field.type, url: field.url };
  }
}

function formView(value: FormInfo, index: number): PendingRequestView {
  const fields = value.fields.map(formFieldView);
  const question = value.metadata?.kind === "question";
  const questions = question
    ? fields
        .filter((field) => field.type === "string" || field.type === "multiselect")
        .map(questionView)
    : [];
  return {
    id: value.id || `form-${index}`,
    type: question ? "question" : "form",
    title: value.title,
    detail: undefined,
    resources: [],
    savePatterns: [],
    questions,
    fields,
    delivery: undefined,
    ownerMessageID: ownerMessageID(value.metadata),
  };
}

function inputView(value: SessionInboxUser, index: number): PendingRequestView {
  return {
    id: value.id || `input-${index}`,
    type: "input",
    title: "Pending input",
    detail: value.payload.text || undefined,
    resources: [],
    savePatterns: [],
    questions: [],
    fields: [],
    delivery: value.delivery,
    ownerMessageID: ownerMessageID(value.payload.metadata),
    createdAt: value.timeCreated,
  };
}

export function pendingRequestViews(
  requests: SessionRequestSnapshot,
  messages: readonly PalotMessage[] = [],
): PendingRequestView[] {
  const values = [
    ...requests.permissions.map((request, index) => ({
      ...permissionView(request, index),
      permissionPreview: permissionPreview(request, messages),
    })),
    ...requests.forms.map(formView),
    ...requests.inbox.flatMap((value, index) =>
      value.type === "user" ? [inputView(value, index)] : [],
    ),
  ];
  return [
    ...new Map(
      values.map((request) => [`${request.type}:${request.id}`, request] as const),
    ).values(),
  ];
}

export function actionableRequestViews(requests: SessionRequestSnapshot): PendingRequestView[] {
  return pendingRequestViews(requests).filter((request) => request.type !== "input");
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

export function sessionActivityAt(session: Pick<PalotSession, "idleAt" | "updatedAt">): number {
  return session.idleAt ?? session.updatedAt;
}
