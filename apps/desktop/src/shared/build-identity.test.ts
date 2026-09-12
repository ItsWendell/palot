import { describe, expect, it } from "vitest";
import { resolveBuildIdentity } from "./build-identity";

describe("resolveBuildIdentity", () => {
  it("always gives local development its own identity", () => {
    expect(resolveBuildIdentity({ development: true, configuredChannel: "stable" })).toEqual({
      channel: "dev",
      label: "Dev",
      displayName: "Palot (Dev)",
      productName: "Palot Dev",
      appId: "dev.palot.desktop.dev",
      userDataName: "Palot (Dev)",
      iconVariant: "dev",
    });
  });

  it("keeps stable builds untagged", () => {
    expect(resolveBuildIdentity({ development: false })).toMatchObject({
      channel: "stable",
      label: null,
      displayName: "Palot",
      productName: "Palot",
      appId: "dev.palot.desktop",
    });
  });

  it("supports beta and nightly release identities", () => {
    expect(
      resolveBuildIdentity({ development: false, configuredChannel: "beta" }).displayName,
    ).toBe("Palot (Beta)");
    expect(
      resolveBuildIdentity({ development: false, configuredChannel: "nightly" }).displayName,
    ).toBe("Palot (Nightly)");
  });

  it("assigns local development checkouts distinct app IDs", () => {
    expect(
      resolveBuildIdentity({ development: true, developmentID: "Palot 2 / feature" }),
    ).toMatchObject({
      appId: "dev.palot.desktop.dev.palot2feature",
      userDataName: "Palot (Dev) (palot2feature)",
    });
  });
});
