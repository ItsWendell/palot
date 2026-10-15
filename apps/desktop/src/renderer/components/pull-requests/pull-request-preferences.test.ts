import { describe, expect, it } from "vitest";
import {
  EMPTY_PULL_REQUEST_FILTERS,
  normalizeOwner,
  normalizeRepository,
  pullRequestFilterQuery,
} from "./pull-request-preferences";

describe("pullRequestFilterQuery", () => {
  it("composes GitHub qualifiers for every active filter", () => {
    expect(pullRequestFilterQuery(EMPTY_PULL_REQUEST_FILTERS)).toBe("");
    expect(
      pullRequestFilterQuery({
        repositories: ["acme/web", "acme/api"],
        organizations: ["example-org"],
        review: "changes_requested",
        checks: "failure",
        hideDrafts: true,
      }),
    ).toBe(
      "repo:acme/web repo:acme/api org:example-org review:changes_requested status:failure draft:false",
    );
  });
});

describe("filter names", () => {
  it("accepts repository names and URLs but nothing that could inject qualifiers", () => {
    expect(normalizeRepository(" Acme/Web ")).toBe("acme/web");
    expect(normalizeRepository("https://github.com/acme/web.git")).toBe("acme/web");
    expect(normalizeRepository("acme/web is:closed")).toBeNull();
    expect(normalizeRepository("acme")).toBeNull();
    expect(normalizeOwner("@Example-Org")).toBe("example-org");
    expect(normalizeOwner("acme org:other")).toBeNull();
  });
});
