import type { PalotBuildChannel } from "./build-identity";

export interface PalotReleaseBuildInfo {
  version: string;
  commitSha: string;
  buildNumber: string;
  channel: PalotBuildChannel;
  openCodeContractVersion: string;
  dirty: boolean;
}

export function formatReleaseBuildLabel(info: PalotReleaseBuildInfo): string {
  const commit = info.commitSha === "unknown" ? info.commitSha : info.commitSha.slice(0, 12);
  return `${info.version} (${info.channel}, ${commit}, build ${info.buildNumber}${info.dirty ? ", dirty" : ""})`;
}
