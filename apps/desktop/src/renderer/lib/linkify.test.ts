import { expect, it } from "vitest";
import { linkSegments } from "./linkify";

it("links http(s) URLs in plain text without trailing sentence punctuation", () => {
  expect(
    linkSegments("See https://example.com/a?b=1. Then (http://x.dev/y) or https://e.com/w_(x)!"),
  ).toEqual([
    { text: "See " },
    { text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
    { text: ". Then (" },
    { text: "http://x.dev/y", href: "http://x.dev/y" },
    { text: ") or " },
    { text: "https://e.com/w_(x)", href: "https://e.com/w_(x)" },
    { text: "!" },
  ]);
});

it("leaves code, other schemes and host-less prefixes as text", () => {
  expect(
    linkSegments(
      "Run `curl https://api.example.com` or open file:///tmp/a, mailto:a@b.c, https://",
    ),
  ).toEqual([
    { text: "Run `curl https://api.example.com` or open file:///tmp/a, mailto:a@b.c, https://" },
  ]);
  expect(linkSegments("plain")).toEqual([{ text: "plain" }]);
});
