/** Palot build-channel identity shared by Electron and the renderer. */

export const PALOT_BUILD_CHANNELS = ["dev", "nightly", "beta", "stable"] as const;

export type PalotBuildChannel = (typeof PALOT_BUILD_CHANNELS)[number];

export interface PalotBuildIdentity {
  channel: PalotBuildChannel;
  label: "Dev" | "Nightly" | "Beta" | null;
  displayName: string;
  productName: string;
  appId: string;
  userDataName: string;
  iconVariant: PalotBuildChannel;
}

interface ResolveBuildIdentityInput {
  development: boolean;
  configuredChannel?: string;
  developmentID?: string;
}

export function resolveBuildIdentity({
  development,
  configuredChannel,
  developmentID,
}: ResolveBuildIdentityInput): PalotBuildIdentity {
  const channel = development ? "dev" : parseBuildChannel(configuredChannel);
  const suffix = channel === "stable" ? "" : ` (${channelLabel(channel)})`;
  const idSuffix = channel === "stable" ? "" : `.${channel}`;
  const devInstance = channel === "dev" ? normalizeDevelopmentID(developmentID) : null;
  const devInstanceSuffix = devInstance ? `.${devInstance}` : "";
  const userDataInstanceSuffix = devInstance ? ` (${devInstance})` : "";

  return {
    channel,
    label: channel === "stable" ? null : channelLabel(channel),
    displayName: `Palot${suffix}`,
    productName: channel === "stable" ? "Palot" : `Palot ${channelLabel(channel)}`,
    appId: `dev.palot.desktop${idSuffix}${devInstanceSuffix}`,
    userDataName: `Palot${suffix}${userDataInstanceSuffix}`,
    iconVariant: channel,
  };
}

function normalizeDevelopmentID(value?: string): string | null {
  const normalized = value
    ?.toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "")
    .slice(0, 32);
  return normalized || null;
}

function parseBuildChannel(value?: string): PalotBuildChannel {
  if (value && PALOT_BUILD_CHANNELS.includes(value as PalotBuildChannel)) {
    return value as PalotBuildChannel;
  }
  return "stable";
}

function channelLabel(channel: Exclude<PalotBuildChannel, "stable">): "Dev" | "Nightly" | "Beta" {
  switch (channel) {
    case "dev":
      return "Dev";
    case "nightly":
      return "Nightly";
    case "beta":
      return "Beta";
  }
}
