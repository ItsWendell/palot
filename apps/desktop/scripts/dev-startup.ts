export function devWindowStartupEnvironment(args: readonly string[]): NodeJS.ProcessEnv {
  const focus = args.includes("--focus");
  const visible = focus || args.includes("--visible");
  return {
    PALOT_START_HIDDEN: visible ? "0" : "1",
    PALOT_START_INACTIVE: visible && !focus ? "1" : "0",
  };
}
