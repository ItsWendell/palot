/** Opt-in prerequisites a scenario declares, checked before any build or launch. */

/**
 * `flag` names a runner option (`profile` is also met by `--trace` and `--app-trace`);
 * `env` names an environment variable that must equal `value`.
 */
export type ScenarioRequirement =
  | { flag: "profile" | "react-scan" | "executable" }
  | { env: string; value: string };

export type RequirementInputs = {
  /** Runner options that are set for this run. */
  flags: ReadonlySet<string>;
  env: Readonly<Record<string, string | undefined>>;
};

/** Requirements of `scenario` that this run does not meet, in declaration order. */
export function unmetRequirements(
  scenario: object,
  inputs: RequirementInputs,
): ScenarioRequirement[] {
  const requires =
    "requires" in scenario && Array.isArray(scenario.requires)
      ? (scenario.requires as ScenarioRequirement[])
      : [];
  return requires.filter((requirement) => {
    if ("env" in requirement) return inputs.env[requirement.env] !== requirement.value;
    if (requirement.flag === "profile")
      return !["profile", "trace", "app-trace"].some((flag) => inputs.flags.has(flag));
    return !inputs.flags.has(requirement.flag);
  });
}

/** `needs --profile`, `needs PALOT_E2E_ALLOW_RUNTIME_DOWNLOAD=1, --executable`. */
export function describeRequirements(requirements: readonly ScenarioRequirement[]): string {
  return `needs ${requirements
    .map((requirement) =>
      "env" in requirement ? `${requirement.env}=${requirement.value}` : `--${requirement.flag}`,
    )
    .join(", ")}`;
}
