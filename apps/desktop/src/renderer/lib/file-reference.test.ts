import { describe, expect, it, vi } from "vitest";
import {
  fileReferenceBases,
  fileReferenceHref,
  locationAtMessage,
  parseFileReference,
  projectRootFromSubpath,
  resolveFileReference,
  workspaceRelativePath,
  type FileReferenceIO,
} from "./file-reference";

const code = (value: string, allowHome = false) =>
  parseFileReference(value, { source: "code", allowHome });
const href = (value: string) => parseFileReference(value, { source: "href" });

describe("parseFileReference", () => {
  it("reads line, column, and range suffixes", () => {
    expect(code("src/x.ts:12")).toEqual({ path: "src/x.ts", line: 12 });
    expect(code("src/x.ts:12:3")).toEqual({ path: "src/x.ts", line: 12, column: 3 });
    expect(code("src/x.ts:12-20")).toEqual({ path: "src/x.ts", line: 12, endLine: 20 });
    expect(code("src/x.ts(12,3)")).toEqual({ path: "src/x.ts", line: 12, column: 3 });
    expect(code("src/x.ts L12")).toEqual({ path: "src/x.ts", line: 12 });
    expect(code("src/x.ts (line 12)")).toEqual({ path: "src/x.ts", line: 12 });
    expect(href("src/x.ts#L12-L20")).toEqual({ path: "src/x.ts", line: 12, endLine: 20 });
    expect(href("src/x.ts#L12C4")).toEqual({ path: "src/x.ts", line: 12, column: 4 });
    expect(code("Dockerfile:3")).toEqual({ path: "Dockerfile", line: 3 });
  });

  it("trims prose punctuation and decodes hrefs", () => {
    expect(code("src/x.ts.")).toEqual({ path: "src/x.ts" });
    expect(code("src/x.ts:12,")).toEqual({ path: "src/x.ts", line: 12 });
    expect(href("docs/my%20file.md")).toEqual({ path: "docs/my file.md" });
    expect(href("README.md#install")).toEqual({ path: "README.md" });
    expect(code("C:\\repo\\src\\x.ts:4")).toEqual({ path: "C:/repo/src/x.ts", line: 4 });
  });

  it("parses file URLs without Node globals (sandboxed renderer)", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "process")!;
    Object.defineProperty(globalThis, "process", { value: undefined, configurable: true });
    try {
      expect(href("file:///Users/me/repo/src/a.ts#L42")).toEqual({
        path: "/Users/me/repo/src/a.ts",
        line: 42,
      });
      expect(href("file:///C:/repo/a%20b.ts")).toEqual({ path: "C:/repo/a b.ts" });
    } finally {
      Object.defineProperty(globalThis, "process", descriptor);
    }
    expect(href("file://server/share/a.ts")).toBeNull();
  });

  it("rejects commands, identifiers, schemes, and UNC paths", () => {
    expect(code("npm test src/x.ts")).toBeNull();
    expect(code("bun run --cwd apps/desktop test")).toBeNull();
    expect(code("src/a.ts src/b.ts")).toBeNull();
    expect(code("src/**/*.ts")).toBeNull();
    expect(code("this.state")).toBeNull();
    expect(code("console.log")).toBeNull();
    expect(code("foo.toString:12")).toBeNull();
    expect(code("v1.2.3")).toBeNull();
    expect(href("mailto:me@example.com")).toBeNull();
    expect(href("tel:5551234")).toBeNull();
    expect(code("C:12")).toBeNull();
    expect(code("//server/share/a.ts")).toBeNull();
    expect(code("docs/my file.md")).toEqual({ path: "docs/my file.md" });
    expect(code("thread.tsx")).toEqual({ path: "thread.tsx" });
  });

  it("keeps encoded # and ? in file URL names", () => {
    expect(href("file:///repo/report%23draft.md#L3")).toEqual({
      path: "/repo/report#draft.md",
      line: 3,
    });
    expect(href("file:///repo/a%3Fb.md?start=7")).toEqual({ path: "/repo/a?b.md", line: 7 });
    expect(code("<file:///repo/My%20Notes.md#intro>")).toEqual({ path: "/repo/My Notes.md" });
  });

  it("keeps file names with spaces but not commands", () => {
    expect(code("My File.md")).toEqual({ path: "My File.md" });
    expect(code("My Folder/file.ts:3")).toEqual({ path: "My Folder/file.ts", line: 3 });
    expect(code("C:\\Program Files\\repo\\a.ts")).toEqual({ path: "C:/Program Files/repo/a.ts" });
    expect(code("/Users/me/My Docs/a.md")).toEqual({ path: "/Users/me/My Docs/a.md" });
    expect(code("npm test src/x.ts")).toBeNull();
    expect(code("git diff src/x.ts")).toBeNull();
    expect(code("run tests src/a.ts")).toBeNull();
    expect(code("run https://example.com")).toBeNull();
    expect(code("see http://localhost:3000/a.js")).toBeNull();
    expect(code("My File.md other.md")).toBeNull();
  });

  it("links home paths only when the connection can open them", () => {
    expect(code("~/notes/a.md")).toBeNull();
    expect(code("~/notes/a.md", true)).toEqual({ path: "~/notes/a.md" });
  });
});

it("builds absolute file hrefs from the workspace directory", () => {
  expect(fileReferenceHref({ path: "src/x.ts", line: 3 }, "/repo")).toBe(
    "file:///repo/src/x.ts#L3",
  );
  expect(fileReferenceHref({ path: "a#b.ts" }, "/repo")).toBe("file:///repo/a%23b.ts");
  expect(fileReferenceHref({ path: "src/x.ts" }, undefined)).toBeUndefined();
  expect(fileReferenceHref({ path: "~/x.ts" }, "/repo")).toBeUndefined();
});

it("matches Windows drive prefixes case-insensitively", () => {
  expect(workspaceRelativePath("C:\\Repo", "c:/repo/src/a.ts")).toBe("src/a.ts");
  expect(workspaceRelativePath("/repo", "/Repo/src/a.ts")).toBeNull();
});

it("derives the project root only from a matching subpath", () => {
  expect(projectRootFromSubpath("/repo/packages/app", "packages/app")).toBe("/repo");
  expect(projectRootFromSubpath("/repo", "")).toBe("/repo");
  expect(projectRootFromSubpath("/repo/packages/app", "../app")).toBeNull();
  expect(projectRootFromSubpath("/elsewhere/app", "packages/app")).toBeNull();
  expect(projectRootFromSubpath("/repo", undefined)).toBeNull();
});

it("orders a message's location before the session's current one, without duplicates", () => {
  expect(
    fileReferenceBases(
      { location: { directory: "/old/app" }, subpath: "app" },
      { location: { directory: "/new/app" }, subpath: "app" },
    ).map((base) => base.directory),
  ).toEqual(["/old/app", "/old", "/new/app", "/new"]);
  expect(
    fileReferenceBases(
      { location: { directory: "C:/Repo/app" }, subpath: "app" },
      { location: { directory: "c:/repo" }, subpath: "" },
    ).map((base) => base.directory),
  ).toEqual(["C:/Repo/app", "C:/Repo"]);
});

it("uses the location a message was written in", () => {
  const messages: Parameters<typeof locationAtMessage>[0] = [
    { id: "m1", type: "user", createdAt: 1, data: {} },
    {
      id: "s1",
      type: "location-switched",
      createdAt: 2,
      data: {
        location: { directory: "/wt" },
        subpath: "",
        previous: { location: { directory: "/repo/app" }, subpath: "app" },
      },
    },
    { id: "m2", type: "user", createdAt: 3, data: {} },
  ];
  const current = { location: { directory: "/wt" } };
  expect(locationAtMessage(messages, "m1", current)).toEqual({
    location: { directory: "/repo/app" },
    subpath: "app",
  });
  expect(locationAtMessage(messages, "m2", current)).toEqual({
    location: { directory: "/wt" },
    subpath: "",
  });
  expect(locationAtMessage(messages, undefined, current)).toBe(current);
});

describe("resolveFileReference", () => {
  const bases = fileReferenceBases({
    location: { directory: "/repo/packages/app", workspaceID: "ws" },
    subpath: "packages/app",
  });

  /** `files` are absolute server paths; reads succeed for any location containing them. */
  function io(files: string[], found: string[] = []) {
    const read = vi.fn(async (location: { directory: string }, path: string) =>
      files.includes(`${location.directory}/${path}`),
    );
    const find = vi.fn(async () => found);
    return { read, find } satisfies FileReferenceIO;
  }

  it("tries the session directory, then the project root", async () => {
    const fake = io(["/repo/packages/app/src/x.ts", "/repo/README.md"]);
    // Repo-root-relative from a subdirectory session: opens in the most specific location.
    await expect(resolveFileReference("packages/app/src/x.ts", bases, fake)).resolves.toEqual({
      kind: "open",
      location: { directory: "/repo/packages/app", workspaceID: "ws" },
      path: "src/x.ts",
    });
    expect(fake.read.mock.calls.map(([location, path]) => `${location.directory}:${path}`)).toEqual(
      [
        // The literal path under the session folder, through the narrowest base first.
        "/repo/packages/app:packages/app/src/x.ts",
        "/repo:packages/app/packages/app/src/x.ts",
        // The same path under the project root.
        "/repo/packages/app:src/x.ts",
      ],
    );
    await expect(resolveFileReference("README.md", bases, fake)).resolves.toEqual({
      kind: "open",
      location: { directory: "/repo", workspaceID: "ws" },
      path: "README.md",
    });
    expect(fake.find).not.toHaveBeenCalled();
  });

  it("resolves parent paths against the root that contains them", async () => {
    const fake = io(["/repo/packages/shared/y.ts"]);
    const result = await resolveFileReference("../shared/y.ts", bases, fake);
    expect(result).toMatchObject({ kind: "open", path: "packages/shared/y.ts" });
  });

  it("falls back to suffix-filtered search", async () => {
    const one = io(
      ["/repo/packages/app/src/thread.tsx"],
      ["packages/app/src/thread.tsx", "packages/app/src/thread-header.tsx"],
    );
    await expect(resolveFileReference("thread.tsx", bases, one)).resolves.toEqual({
      kind: "open",
      location: { directory: "/repo/packages/app", workspaceID: "ws" },
      path: "src/thread.tsx",
    });
    expect(one.find).toHaveBeenCalledWith({ directory: "/repo", workspaceID: "ws" }, "thread.tsx");

    const many = io([], ["a/index.ts", "b/index.ts", "b/index.tsx"]);
    await expect(resolveFileReference("index.ts", bases, many)).resolves.toEqual({
      kind: "choose",
      location: { directory: "/repo", workspaceID: "ws" },
      query: "index.ts",
      candidates: ["a/index.ts", "b/index.ts"],
    });
  });

  it("reports missing and outside files without opening", async () => {
    const fake = io([]);
    await expect(resolveFileReference("src/gone.ts", bases, fake)).resolves.toEqual({
      kind: "missing",
      absolutePath: "/repo/packages/app/src/gone.ts",
    });
    await expect(resolveFileReference("/etc/hosts", bases, fake)).resolves.toEqual({
      kind: "outside",
      absolutePath: "/etc/hosts",
    });
    await expect(resolveFileReference("../../../x.ts", bases, fake)).resolves.toMatchObject({
      kind: "outside",
    });
  });

  it("finds a file the old location no longer has in the current one", async () => {
    const moved = fileReferenceBases(
      { location: { directory: "/old" }, subpath: "" },
      { location: { directory: "/new" }, subpath: "" },
    );
    await expect(resolveFileReference("src/x.ts", moved, io(["/new/src/x.ts"]))).resolves.toEqual({
      kind: "open",
      location: { directory: "/new" },
      path: "src/x.ts",
    });
  });

  it("matches search results case-insensitively on Windows drives", async () => {
    const windows = [{ directory: "C:/Repo" }];
    const fake = io(["C:/Repo/Src/Index.ts"], ["Src/Index.ts", "src/index.tsx"]);
    await expect(resolveFileReference("INDEX.ts", windows, fake)).resolves.toEqual({
      kind: "open",
      location: { directory: "C:/Repo" },
      path: "Src/Index.ts",
    });
  });

  it("opens through the wider base when the narrow one cannot read a symlinked file", async () => {
    const fake = io([]);
    // The session folder holds a link to a file elsewhere in the repo.
    fake.read.mockImplementation(async (location) => location.directory === "/repo");
    await expect(resolveFileReference("src/link.ts", bases, fake)).resolves.toEqual({
      kind: "open",
      location: { directory: "/repo", workspaceID: "ws" },
      path: "packages/app/src/link.ts",
    });
  });

  it("surfaces request failures instead of reporting a missing file", async () => {
    const fake = io([]);
    fake.read.mockRejectedValue(new Error("offline"));
    await expect(resolveFileReference("src/x.ts", bases, fake)).rejects.toThrow("offline");
  });

  it("stops when a newer click aborts it", async () => {
    const controller = new AbortController();
    const fake = io([]);
    fake.read.mockImplementation(async () => {
      controller.abort();
      return false;
    });
    await expect(
      resolveFileReference("src/x.ts", bases, fake, controller.signal),
    ).rejects.toBeTruthy();
    expect(fake.find).not.toHaveBeenCalled();
  });
});
