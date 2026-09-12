import { describe, expect, it } from "vitest";
import { duckDuckGoFaviconUrl } from "./markdown-favicon";

describe("Markdown favicons", () => {
  it("builds a DuckDuckGo URL from only the public hostname", () => {
    expect(duckDuckGoFaviconUrl("https://docs.github.com/en/rest?token=secret")).toBe(
      "https://icons.duckduckgo.com/ip9/docs.github.com.ico",
    );
  });

  it.each([
    "http://localhost:3000/docs",
    "http://127.0.0.1/docs",
    "https://8.8.8.8/docs",
    "http://[::1]/docs",
    "https://service.internal/docs",
    "https://service.corp/docs",
    "https://router.home.arpa/docs",
    "https://printer.local/docs",
    "https://hidden-service.onion/docs",
    "mailto:person@example.com",
  ])("does not request icons for non-public destinations: %s", (value) => {
    expect(duckDuckGoFaviconUrl(value)).toBeNull();
  });
});
