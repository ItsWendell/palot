// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, expect, test } from "vitest";
import {
  allowedDestination,
  destinationOrigin,
  fileURLWithin,
  localFileURL,
  normalizeURL,
} from "./policy";

const directory = mkdtempSync(path.join(tmpdir(), "palot-browser-policy-"));
const root = path.join(directory, "repo");
const outside = path.join(directory, "repo-other");
mkdirSync(path.join(root, "out"), { recursive: true });
mkdirSync(outside);
const insideFile = path.join(root, "out", "index.html");
const outsideFile = path.join(outside, "secret.txt");
writeFileSync(insideFile, "workspace document");
writeFileSync(outsideFile, "outside workspace");
const url = (file: string) => pathToFileURL(file).href;
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("allows cross-origin HTTP navigation but rejects unsafe destinations and embedded credentials", () => {
  expect(destinationOrigin("https://other.example/path")).toBe("https://other.example");
  expect(destinationOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
  for (const value of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:pass@example.com",
  ]) {
    expect(destinationOrigin(value)).toBeUndefined();
  }
});

test("file documents load only from existing workspace paths and never from a host", () => {
  expect(localFileURL("file:///C:/work/out/report.html")).toBe("file:///C:/work/out/report.html");
  expect(localFileURL("file://server/share/report.html")).toBeUndefined();
  expect(localFileURL("https://example.com")).toBeUndefined();
  const roots = [root];
  expect(fileURLWithin(url(insideFile), roots)).toBe(true);
  expect(fileURLWithin(url(root), roots)).toBe(true);
  expect(fileURLWithin(url(outsideFile), roots)).toBe(false);
  expect(fileURLWithin(`${url(root)}/../repo-other/secret.txt`, roots)).toBe(false);
  expect(fileURLWithin(`${url(root)}/out/%2e%2e/%2e%2e/repo-other/secret.txt`, roots)).toBe(false);
  expect(fileURLWithin(`${url(root)}%2f..%2frepo-other/secret.txt`, roots)).toBe(false);
  expect(fileURLWithin(`${url(root)}%5c..%5crepo-other/secret.txt`, roots)).toBe(false);
  expect(fileURLWithin(`${url(root)}/%zz`, roots)).toBe(false);
  expect(fileURLWithin(url(path.join(root, "missing.html")), roots)).toBe(false);
  expect(fileURLWithin(url(insideFile), [])).toBe(false);
  expect(fileURLWithin("file://server/share/report.html", roots)).toBe(false);
  expect(allowedDestination(url(insideFile))).toBe(false);
  expect(allowedDestination(url(insideFile), { fileRoots: roots })).toBe(true);
  expect(allowedDestination(url(outsideFile), { fileRoots: roots })).toBe(false);
  expect(allowedDestination("javascript:alert(1)", { fileRoots: roots })).toBe(false);
  expect(normalizeURL(url(insideFile), { fileRoots: roots })).toBe(url(insideFile));
  expect(() => normalizeURL(url(insideFile))).toThrow();
  expect(() => normalizeURL(url(outsideFile), { fileRoots: roots })).toThrow();
  expect(normalizeURL("localhost:3000", { fileRoots: roots })).toBe("http://localhost:3000");
});

test("resolved files cannot escape through file or directory symlinks", () => {
  const fileLink = path.join(root, "secret.txt");
  const directoryLink = path.join(root, "outside");
  const insideLink = path.join(root, "index.html");
  const rootAlias = path.join(directory, "workspace");
  symlinkSync(outsideFile, fileLink, "file");
  symlinkSync(outside, directoryLink, process.platform === "win32" ? "junction" : "dir");
  symlinkSync(insideFile, insideLink, "file");
  symlinkSync(root, rootAlias, process.platform === "win32" ? "junction" : "dir");
  expect(fileURLWithin(url(fileLink), [root])).toBe(false);
  expect(fileURLWithin(url(path.join(directoryLink, "secret.txt")), [root])).toBe(false);
  expect(() => normalizeURL(url(fileLink), { fileRoots: [root] })).toThrow();
  expect(fileURLWithin(url(insideLink), [root])).toBe(true);
  expect(fileURLWithin(url(path.join(rootAlias, "out", "index.html")), [rootAlias])).toBe(true);
  expect(fileURLWithin(url(path.join(rootAlias, "secret.txt")), [rootAlias])).toBe(false);
});

test("percent characters in workspace names are decoded only once", () => {
  const percentRoot = path.join(directory, "100%-work");
  mkdirSync(percentRoot);
  const file = path.join(percentRoot, "out.html");
  writeFileSync(file, "workspace document");
  expect(fileURLWithin(url(file), [percentRoot])).toBe(true);
});
