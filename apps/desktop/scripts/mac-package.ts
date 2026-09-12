export interface MacPackageTarget {
  architecture: "arm64" | "x64";
  machoArchitecture: "arm64" | "x86_64";
  builderArgument: "--arm64" | "--x64";
  releaseDirectory: "mac-arm64" | "mac";
}

export function resolveMacPackageTarget(architecture: NodeJS.Architecture): MacPackageTarget {
  if (architecture === "arm64") {
    return {
      architecture,
      machoArchitecture: "arm64",
      builderArgument: "--arm64",
      releaseDirectory: "mac-arm64",
    };
  }
  if (architecture === "x64") {
    return {
      architecture,
      machoArchitecture: "x86_64",
      builderArgument: "--x64",
      releaseDirectory: "mac",
    };
  }
  throw new Error(`Unsupported macOS architecture: ${architecture}`);
}
