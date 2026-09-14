import { expect, it } from "vitest";
import {
  absoluteServerPath,
  directoryBreadcrumbs,
  resolveDirectoryEntry,
} from "./server-directory-path";

it("preserves POSIX, drive and UNC roots while navigating directory entries", () => {
  expect(resolveDirectoryEntry("/srv/project", "src")).toBe("/srv/project/src");
  expect(resolveDirectoryEntry("/srv/project", "../other")).toBe("/srv/other");
  expect(resolveDirectoryEntry("C:\\work", "src")).toBe("C:/work/src");
  expect(directoryBreadcrumbs("\\\\host\\share\\project")).toEqual([
    { label: "//host/share/", path: "//host/share/" },
    { label: "project", path: "//host/share/project" },
  ]);
  expect(absoluteServerPath("relative/path")).toBe(false);
  expect(absoluteServerPath("C:\\work")).toBe(true);
});
