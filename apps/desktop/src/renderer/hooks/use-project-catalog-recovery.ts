import type { LocationRef } from "@opencode/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import type { PalotCapabilityError } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import {
  capabilityErrorDetail,
  describeOpenCodeError,
  readOpenCodeErrorDetail,
  type OpenCodeErrorDetail,
} from "../lib/opencode-error-detail";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { modelCatalogQueryKey, useModelCatalog } from "./use-model-catalog";
import { settingsSnapshotQueryOptions } from "./use-settings-snapshot";

/** One catalog OpenCode could not load for a project, with the typed error when it sent one. */
export interface ProjectCatalogFailure {
  capability: string;
  label: string;
  message: string;
  reference: string | null;
  detail: OpenCodeErrorDetail | null;
}

/**
 * Why a project's composer catalogs failed, for one connection and location. Every field
 * describes the location it names; a reply for another location never lands here.
 */
export interface ProjectCatalogRecovery {
  connectionID: string;
  location: LocationRef;
  failures: ProjectCatalogFailure[];
  retrying: boolean;
  /** Runs the failed catalog requests again for this location. */
  retry(): Promise<void>;
}

function thrownFailure(capability: string, label: string, error: Error): ProjectCatalogFailure {
  const detail = readOpenCodeErrorDetail(error);
  return {
    capability,
    label,
    message: detail ? describeOpenCodeError(detail) : error.message || "Unknown OpenCode error",
    reference: detail?.reference ?? null,
    detail,
  };
}

function reportedFailure(error: PalotCapabilityError): ProjectCatalogFailure {
  return {
    capability: error.capability,
    label: error.label,
    message: error.message,
    reference: error.reference ?? null,
    detail: capabilityErrorDetail(error),
  };
}

/**
 * Explains why the model and agent catalogs a draft needs failed for one project location.
 * Shares the composer's catalog queries rather than fetching separately, and clears as
 * soon as they load.
 */
export function useProjectCatalogRecovery({
  location,
  projectID,
  enabled,
}: {
  location: LocationRef;
  projectID: string;
  enabled: boolean;
}): ProjectCatalogRecovery | null {
  const runtime = useAtomValue(runtimeAtom);
  const connected = canFetchOpenCode(runtime);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const queryClient = useQueryClient();
  const models = useModelCatalog(location, enabled);
  const agentOptions = settingsSnapshotQueryOptions(
    connectionID,
    {
      directory: location.directory,
      ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
      projectID,
      capabilities: ["agents"],
    },
    enabled && connected,
  );
  const agents = useQuery(agentOptions);

  const modelFailures = models.error
    ? [thrownFailure("models", "Available models", models.error)]
    : (models.data?.errors ?? [])
        .filter((error) => error.capability === "models")
        .map(reportedFailure);
  const agentFailures = agents.error
    ? [thrownFailure("agents", "Agents", agents.error)]
    : (agents.data?.errors ?? [])
        .filter((error) => error.capability === "agents")
        .map(reportedFailure);

  const failures = [...modelFailures, ...agentFailures];
  if (!enabled || !connected || failures.length === 0) return null;
  // Keys carry the connection and location, so a late reply for another location
  // settles its own query and never replaces this one.
  const failed = [
    ...(modelFailures.length ? [modelCatalogQueryKey(connectionID, location)] : []),
    ...(agentFailures.length ? [agentOptions.queryKey] : []),
  ];
  return {
    connectionID,
    location,
    failures,
    retrying: models.isFetching || agents.isFetching,
    async retry() {
      await Promise.all(
        failed.map((queryKey) => queryClient.refetchQueries({ queryKey, exact: true })),
      );
    },
  };
}

/** One sentence for where a blocked draft explains itself. */
export function projectCatalogFailureText(recovery: ProjectCatalogRecovery): string {
  const labels = recovery.failures.map((failure) => failure.label.toLowerCase());
  const messages = [...new Set(recovery.failures.map((failure) => failure.message))];
  return `OpenCode couldn't load ${labels.join(" and ")} for this project: ${messages.join(" ")}`;
}
