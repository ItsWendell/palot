import { describe, expect, test } from "vitest";
import {
  resolveReleaseVersion,
  verifyPackagedReleaseVersion,
  verifyReleaseTag,
} from "./release-build-info";

describe("verifyReleaseTag", () => {
  test("accepts matching stable and prerelease tags", () => {
    expect(() => verifyReleaseTag({ PALOT_RELEASE_TAG: "v1.2.3" }, "1.2.3")).not.toThrow();
    expect(() => verifyReleaseTag({ PALOT_RELEASE_TAG: "v1.2.3-rc.4" }, "1.2.3")).not.toThrow();
    expect(() => verifyReleaseTag({ PALOT_RELEASE_TAG: "v1.2.3-beta.1" }, "1.2.3")).not.toThrow();
    expect(() =>
      verifyReleaseTag({ PALOT_RELEASE_TAG: "v1.2.3-nightly.20260912090000.42" }, "1.2.3"),
    ).not.toThrow();
  });

  test.each(["1.2.3", "v01.2.3", "v1.2.3-beta.01", "v1.2.3-beta", "v1.2.3+build"])(
    "rejects noncanonical tag %s",
    (tag) => {
      expect(() => verifyReleaseTag({ PALOT_RELEASE_TAG: tag }, "1.2.3")).toThrow(
        "Unsupported release tag",
      );
    },
  );

  test("uses the GitHub tag context when present", () => {
    expect(() =>
      verifyReleaseTag({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v1.2.3-rc.1" }, "1.2.3"),
    ).not.toThrow();
  });

  test("rejects malformed and mismatched release tags", () => {
    expect(() => verifyReleaseTag({ PALOT_RELEASE_TAG: "nightly" }, "1.2.3")).toThrow(
      "Unsupported release tag",
    );
    expect(() => verifyReleaseTag({ PALOT_RELEASE_TAG: "v1.2.4" }, "1.2.3")).toThrow(
      "does not match package version",
    );
  });

  test("does not constrain ordinary branch builds", () => {
    expect(() =>
      verifyReleaseTag({ GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main" }, "1.2.3"),
    ).not.toThrow();
  });
});

describe("resolveReleaseVersion", () => {
  const now = new Date("2026-09-12T09:30:45.000Z");

  test("keeps the stable base version without inventing a new version train", () => {
    expect(resolveReleaseVersion("stable", {}, "0.12.0", now)).toBe("0.12.0");
  });

  test.each(["nightly", "beta", "dev"] as const)(
    "derives %s prereleases from the same base and UTC timestamp",
    (channel) => {
      expect(resolveReleaseVersion(channel, {}, "0.12.0", now)).toBe(
        `0.12.0-${channel}.20260912093045`,
      );
      expect(resolveReleaseVersion(channel, { GITHUB_RUN_NUMBER: "42" }, "0.12.0", now)).toBe(
        `0.12.0-${channel}.20260912093045.42`,
      );
    },
  );

  test("uses numeric build overrides but keeps arbitrary local labels out of SemVer", () => {
    expect(
      resolveReleaseVersion(
        "nightly",
        { PALOT_BUILD_NUMBER: "43", GITHUB_RUN_NUMBER: "42" },
        "0.12.0",
        now,
      ),
    ).toBe("0.12.0-nightly.20260912093045.43");
    for (const build of ["local", "01", "test/build", "-1"]) {
      expect(resolveReleaseVersion("nightly", { PALOT_BUILD_NUMBER: build }, "0.12.0", now)).toBe(
        "0.12.0-nightly.20260912093045",
      );
    }
  });

  test.each([
    ["stable", "v0.12.0"],
    ["nightly", "v0.12.0-nightly.20260912093045.42"],
    ["beta", "v0.12.0-beta.1"],
    ["beta", "v0.12.0-rc.2"],
  ] as const)("preserves the exact %s release tag %s in app metadata", (channel, tag) => {
    expect(resolveReleaseVersion(channel, { PALOT_RELEASE_TAG: tag }, "0.12.0", now)).toBe(
      tag.slice(1),
    );
  });

  test.each([
    ["stable", "v0.12.0-beta.1"],
    ["nightly", "v0.12.0"],
    ["beta", "v0.12.0-nightly.1"],
  ] as const)("rejects tagging a %s build as %s", (channel, tag) => {
    expect(() => resolveReleaseVersion(channel, { PALOT_RELEASE_TAG: tag }, "0.12.0", now)).toThrow(
      "requires the",
    );
  });

  test.each(["0.12", "0.12.0-beta.1", "00.12.0"])("rejects invalid base %s", (base) => {
    expect(() => resolveReleaseVersion("stable", {}, base, now)).toThrow(
      "base version must be stable SemVer",
    );
  });
});

describe("verifyPackagedReleaseVersion", () => {
  test("also accepts a generated development prerelease", () => {
    const version = resolveReleaseVersion("dev", {}, "0.12.0", new Date("2026-09-12T09:30:45Z"));
    expect(() => verifyPackagedReleaseVersion(version, "dev", {}, "0.12.0")).not.toThrow();
  });
  test("accepts a rolling build without regenerating its timestamp at verification time", () => {
    expect(() =>
      verifyPackagedReleaseVersion("0.12.0-nightly.20260912093045.42", "nightly", {}, "0.12.0"),
    ).not.toThrow();
  });

  test("rejects a different exact candidate than the selected release tag", () => {
    expect(() =>
      verifyPackagedReleaseVersion(
        "0.12.0-beta.1",
        "beta",
        { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.12.0-beta.2" },
        "0.12.0",
      ),
    ).toThrow("does not match release version");
  });

  test.each([
    ["0.11.0", "stable"],
    ["0.12.0", "nightly"],
    ["0.12.0-nightly.1", "stable"],
  ] as const)("rejects packaged %s in the %s channel", (version, channel) => {
    expect(() => verifyPackagedReleaseVersion(version, channel, {}, "0.12.0")).toThrow();
  });
});
