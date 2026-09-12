import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export function assertRendererCss(css: string): void {
  if (/animation\s*:[^;{}]*scroll\(/.test(css)) {
    throw new Error(
      "Renderer CSS contains a scroll timeline inside the animation shorthand, which Electron rejects.",
    );
  }
  if (!/animation-timeline\s*:\s*scroll\(self y\)/.test(css)) {
    throw new Error("Renderer CSS is missing the thread scroll-fade animation timeline.");
  }
  if (!/(?:^|[;{])\s*backdrop-filter\s*:/.test(css)) {
    throw new Error("Renderer CSS is missing the standard backdrop-filter property.");
  }
}

export async function verifyRendererCss(outputDirectory: string): Promise<void> {
  const assetsDirectory = path.join(outputDirectory, "assets");
  const files = (await readdir(assetsDirectory)).filter((file) => file.endsWith(".css"));
  if (files.length === 0) throw new Error("Renderer build did not emit a CSS asset.");

  const stylesheets = await Promise.all(
    files.map((file) => readFile(path.join(assetsDirectory, file), "utf8")),
  );
  assertRendererCss(stylesheets.join("\n"));
}
