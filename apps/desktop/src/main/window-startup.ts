export type StartupWindowPresentation = "hidden" | "inactive" | "focused";

export function startupWindowPresentation(env: NodeJS.ProcessEnv): StartupWindowPresentation {
  if (env.PALOT_START_HIDDEN === "1" || env.PALOT_E2E_HIDDEN === "1") return "hidden";
  if (env.PALOT_START_INACTIVE === "1" || env.PALOT_E2E_INACTIVE === "1") return "inactive";
  return "focused";
}
