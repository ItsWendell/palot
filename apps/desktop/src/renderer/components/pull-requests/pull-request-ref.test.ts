import { describe, expect, it } from "vitest";
import {
  formatPullRequestParam,
  parsePullRequestParam,
  validatePullRequestsSearch,
} from "./pull-request-ref";

describe("pull request route param", () => {
  it("round-trips a ref, including enterprise hosts, and lowercases it", () => {
    const ref = { host: "GitHub.Example.com", repository: "Acme/Web", number: 12 };
    expect(formatPullRequestParam(ref)).toBe("github.example.com/acme/web/12");
    expect(parsePullRequestParam("github.example.com/Acme/Web/12")).toEqual({
      host: "github.example.com",
      repository: "acme/web",
      number: 12,
    });
  });

  it.each(["", "github.com/acme/web", "github.com/acme/web/0", "github.com/acme/../12", 5])(
    "rejects %o and drops it from the route search",
    (value) => {
      expect(parsePullRequestParam(value)).toBeNull();
      expect(validatePullRequestsSearch({ pr: value, profileID: "p" })).toEqual({
        profileID: "p",
      });
    },
  );
});
