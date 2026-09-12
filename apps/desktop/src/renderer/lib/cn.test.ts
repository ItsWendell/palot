import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("keeps semantic font sizes alongside text colors", () => {
    expect(cn("text-tag", "text-secondary-foreground")).toBe("text-tag text-secondary-foreground");
    expect(cn("text-meta", "text-muted-foreground")).toBe("text-meta text-muted-foreground");
  });

  it("lets the last semantic or standard font size win without removing color", () => {
    expect(cn("text-sm text-muted-foreground", "text-code-compact")).toBe(
      "text-muted-foreground text-code-compact",
    );
    expect(cn("text-page-title text-primary", "text-lg")).toBe("text-primary text-lg");
    expect(cn("text-meta", "text-tag")).toBe("text-tag");
  });

  it("resolves semantic size conflicts independently for each modifier", () => {
    expect(cn("text-meta hover:text-code md:text-page-title", "hover:text-tag md:text-sm")).toBe(
      "text-meta hover:text-tag md:text-sm",
    );
  });
});
