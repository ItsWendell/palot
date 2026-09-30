import { describe, expect, it } from "vitest";
import { resolveBrowserAddress } from "./browser-address";

describe("browser address entry", () => {
  it.each([
    ["google", "https://www.google.com/search"],
    ["duckduckgo", "https://duckduckgo.com/"],
    ["bing", "https://www.bing.com/search"],
  ] as const)("searches with %s, encoding terms in the query", (engine, page) => {
    const result = new URL(resolveBrowserAddress("  how to use C++ & Rust?  ", engine));
    expect(`${result.origin}${result.pathname}`).toBe(page);
    expect(result.searchParams.get("q")).toBe("how to use C++ & Rust?");
  });

  it("searches ambiguous single tokens instead of treating them as hosts", () => {
    const result = new URL(resolveBrowserAddress("documentation", "duckduckgo"));
    expect(result.searchParams.get("q")).toBe("documentation");
  });

  it.each([
    ["example.com/docs?q=1", "https://example.com/docs?q=1"],
    ["sub.example.co.uk:8443/path", "https://sub.example.co.uk:8443/path"],
    ["8.8.8.8:443", "https://8.8.8.8/"],
    ["localhost:3000/docs", "http://localhost:3000/docs"],
    ["app.localhost:3000/docs", "http://app.localhost:3000/docs"],
    ["127.0.0.1:8080", "http://127.0.0.1:8080/"],
    ["127.0.0.2:8080", "http://127.0.0.2:8080/"],
    ["0.0.0.0:8080", "http://0.0.0.0:8080/"],
    ["[::1]:3000/docs", "http://[::1]:3000/docs"],
    ["[::]:3000", "http://[::]:3000/"],
    ["[2001:db8::1]:8080", "https://[2001:db8::1]:8080/"],
  ])("recognizes bare address %s", (input, expected) => {
    expect(resolveBrowserAddress(input, "google")).toBe(expected);
  });

  it("preserves explicit web, blank, and syntactically valid file URLs", () => {
    expect(resolveBrowserAddress("  HTTP://Example.com/path  ", "bing")).toBe(
      "HTTP://Example.com/path",
    );
    expect(resolveBrowserAddress("about:blank", "bing")).toBe("about:blank");
    expect(resolveBrowserAddress("  ", "bing")).toBe("about:blank");
    expect(resolveBrowserAddress("file:///workspace/page.html", "bing")).toBe(
      "file:///workspace/page.html",
    );
  });

  it.each([
    "javascript:alert(1)",
    "javascript: alert(1)",
    "data:text/html,hello",
    "ftp://example.com",
    "about:config",
    "https:example.com",
    "file://[",
    "https://",
    "example.com:abc",
    "localhost:notaport",
    "example.com:65536",
    "[::1]:65536",
    "[not-ipv6]",
    "[::1",
    "example..com",
    "bad-.com",
    "999.999.999.999",
  ])("rejects an unsupported or malformed URL: %s", (input) => {
    expect(() => resolveBrowserAddress(input, "google")).toThrow();
  });
});
