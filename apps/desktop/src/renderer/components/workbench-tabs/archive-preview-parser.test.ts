import { describe, expect, it } from "vitest";
import { gzipSync, strToU8, zipSync } from "fflate";
import { openPreviewArchive } from "./archive-preview-parser";

describe("archive previews", () => {
  it("lists ZIP metadata and reads only supplied bytes", () => {
    const data = zipSync({ "folder/": new Uint8Array(), "folder/hello.txt": strToU8("hello") });
    const archive = openPreviewArchive(data, "example.jar");
    expect(archive.entries).toMatchObject([
      { path: "folder/", directory: true },
      { path: "folder/hello.txt", size: 5 },
    ]);
    expect(new TextDecoder().decode(archive.read("folder/hello.txt"))).toBe("hello");
    expect(() => archive.read("missing")).toThrow();
  });
  it("rejects traversal, duplicate paths, excessive expansion, too many entries and corrupt ZIP data", () => {
    expect(() => openPreviewArchive(zipSync({ "../outside": strToU8("no") }), "bad.zip")).toThrow();
    expect(() =>
      openPreviewArchive(zipSync({ bomb: new Uint8Array(1024 * 1024) }), "bad.zip"),
    ).toThrow(/limit/);
    expect(() =>
      openPreviewArchive(
        zipSync(
          Object.fromEntries(Array.from({ length: 2049 }, (_, i) => [String(i), new Uint8Array()])),
        ),
        "bad.zip",
      ),
    ).toThrow(/limit/);
    const corrupt = zipSync({ "hello.txt": strToU8("hello") }, { level: 0 });
    corrupt[39] = corrupt[39]! ^ 1;
    expect(() => openPreviewArchive(corrupt, "bad.zip").read("hello.txt")).toThrow();
    expect(() => openPreviewArchive(new Uint8Array([1, 2]), "bad.zip")).toThrow();
  });
  it("bounds gzip output independently of its claimed size", () => {
    expect(
      new TextDecoder().decode(
        openPreviewArchive(gzipSync(strToU8("hello")), "hello.txt.gz").read("hello.txt"),
      ),
    ).toBe("hello");
    expect(() => openPreviewArchive(gzipSync(new Uint8Array(1024 * 1024)), "bomb.gz")).toThrow(
      /limit/,
    );
  });
  it("checks TAR checksums and rejects links without accessing the filesystem", () => {
    const tar = new Uint8Array(2048);
    const put = (offset: number, text: string) => tar.set(strToU8(text), offset);
    put(0, "hello.txt");
    put(124, "00000000005\0");
    put(136, "00000000000\0");
    put(156, "0");
    tar.fill(32, 148, 156);
    const checksum = tar.subarray(0, 512).reduce((sum, value) => sum + value, 0);
    put(148, `${checksum.toString(8).padStart(6, "0")}\0 `);
    put(512, "hello");
    expect(new TextDecoder().decode(openPreviewArchive(tar, "example.tar").read("hello.txt"))).toBe(
      "hello",
    );
    tar[156] = 50;
    expect(() => openPreviewArchive(tar, "example.tar")).toThrow();
  });
});
