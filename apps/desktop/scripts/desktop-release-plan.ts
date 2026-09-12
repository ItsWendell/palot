import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { resolveReleaseVersion, verifyReleaseVersions } from "./release-build-info";

export function releasePlan(
  environment: NodeJS.ProcessEnv,
  now = new Date(),
): {
  channel: "stable" | "nightly";
  tag: string;
  publish: boolean;
} {
  const pushed = environment.GITHUB_EVENT_NAME === "push";
  if (!pushed && environment.GITHUB_EVENT_NAME !== "workflow_dispatch")
    throw new Error("Unsupported release trigger.");
  if (!pushed && environment.GITHUB_REF !== "refs/heads/main")
    throw new Error("Dispatch the release workflow from main.");
  const channel = pushed ? "stable" : environment.INPUT_CHANNEL;
  if (channel !== "stable" && channel !== "nightly") throw new Error("Choose stable or nightly.");
  const requestedTag = pushed ? environment.GITHUB_REF_NAME : environment.INPUT_TAG?.trim();
  if (pushed && environment.GITHUB_REF_TYPE !== "tag")
    throw new Error("Stable releases require a tag push.");
  if (channel === "stable" && !requestedTag)
    throw new Error("Stable releases require an existing version tag.");
  if (channel === "nightly" && requestedTag)
    throw new Error("Nightly tags are generated once by the release plan.");
  const version = resolveReleaseVersion(
    channel,
    {
      PALOT_RELEASE_TAG: requestedTag,
      GITHUB_RUN_NUMBER: environment.GITHUB_RUN_NUMBER,
    },
    undefined,
    now,
  );
  return { channel, tag: `v${version}`, publish: pushed || environment.INPUT_PUBLISH === "true" };
}

if (import.meta.main) {
  verifyReleaseVersions();
  const plan = releasePlan(process.env);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (plan.channel === "stable") {
    const taggedSha = execFileSync("git", ["rev-parse", "--verify", `${plan.tag}^{commit}`], {
      encoding: "utf8",
    }).trim();
    if (taggedSha !== sha) throw new Error("Checkout is not the exact stable tag commit.");
  } else if (sha !== process.env.GITHUB_SHA)
    throw new Error("Nightly checkout differs from the workflow revision.");
  if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim())
    throw new Error("Release checkout is dirty.");
  if (!process.env.GITHUB_OUTPUT)
    throw new Error("Release planning requires GitHub Actions outputs.");
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `sha=${sha}\ntag=${plan.tag}\nchannel=${plan.channel}\npublish=${plan.publish}\n`,
  );
  console.log(JSON.stringify({ ...plan, sha }, null, 2));
}
