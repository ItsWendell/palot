import { describe, expect, it } from "vitest";
import { markdownMediaSource } from "./markdown-media";

describe("markdown media policy", () => {
  it.each([
    "https://example.com/a.mp3",
    "http://localhost/a.mp4",
    "//example.com/a.wav",
    "../a.ogg",
    "/outside/a.webm",
    "file://remote/repo/a.mp4",
    "javascript:alert(1)",
  ])("does not load %s", (url) => {
    expect(markdownMediaSource(url, "/repo")).toBeNull();
  });
  it("loads workspace media and explicit embedded bytes without web requests", () => {
    expect(markdownMediaSource("./clips/a.mp4", "/repo")).toMatchObject({
      kind: "video",
      path: "clips/a.mp4",
      mime: "video/mp4",
    });
    expect(markdownMediaSource("file:///repo/a.m4a", "/repo")).toMatchObject({
      kind: "audio",
      path: "a.m4a",
    });
    expect(markdownMediaSource("data:audio/wav;base64,AAAA")).toMatchObject({
      kind: "audio",
      url: "data:audio/wav;base64,AAAA",
    });
  });
});
