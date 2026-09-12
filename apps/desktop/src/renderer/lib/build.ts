import { resolveBuildIdentity } from "../../shared";

export const palotBuild = Object.freeze({
  ...__PALOT_RELEASE_BUILD_INFO__,
  ...resolveBuildIdentity({
    development: import.meta.env.DEV,
    configuredChannel: __PALOT_BUILD_CHANNEL__,
  }),
});
