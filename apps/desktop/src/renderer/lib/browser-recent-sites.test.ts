import { describe, expect, it } from "vitest";
import {
  isBrowserRecentSites,
  recordBrowserRecentSite,
  suggestedBrowserSites,
} from "./browser-recent-sites";

describe("browser recent sites", () => {
  it("counts navigations, not title updates, and skips non-web pages", () => {
    let sites = recordBrowserRecentSite(
      {},
      "profile",
      { url: "https://example.com/docs#intro", title: "" },
      { visit: true, now: 1 },
    );
    sites = recordBrowserRecentSite(
      sites,
      "profile",
      { url: "https://example.com/docs", title: "Docs" },
      { visit: false, now: 2 },
    );
    for (const url of ["about:blank", "file:///etc/passwd", "javascript:alert(1)"])
      sites = recordBrowserRecentSite(sites, "profile", { url, title: "x" }, { visit: true });
    expect(sites.profile).toEqual([
      { url: "https://example.com/docs", title: "Docs", visits: 1, lastVisitedAt: 1 },
    ]);
    expect(isBrowserRecentSites(sites)).toBe(true);
    expect(isBrowserRecentSites({ profile: [{ url: "file:///x", title: "", visits: 1 }] })).toBe(
      false,
    );
  });

  it("ranks frequent recent sites first", () => {
    const day = 86_400_000;
    const now = 100 * day;
    const ranked = suggestedBrowserSites(
      [
        { url: "https://old.example/", title: "Old", visits: 20, lastVisitedAt: now - 90 * day },
        { url: "https://new.example/", title: "New", visits: 3, lastVisitedAt: now - day },
        { url: "https://once.example/", title: "Once", visits: 1, lastVisitedAt: now },
      ],
      2,
      now,
    );
    expect(ranked.map((site) => site.title)).toEqual(["New", "Old"]);
  });
});
