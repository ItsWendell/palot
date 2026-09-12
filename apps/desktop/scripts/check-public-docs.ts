/** Check public Markdown file links without depending on local maintainer archives. */
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRIVATE_DIRECTORY = /(?:^|\/)(?:\.private|\.local|\.notes|\.audit)(?:\/|$)/;
const INTERNAL_DOCS = /^docs\/(?:plans|research|palot-2|release-readiness|branding)(?:\/|$)/;

function publicMarkdown(file: string): boolean {
  return file.endsWith(".md") && (!file.includes("/") || file.startsWith("docs/"));
}

/** Return link destinations from prose, not Markdown/HTML examples inside code. */
export function markdownFileLinks(markdown: string): string[] {
  const prose = markdown
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, "")
    .replace(/<!--[^]*?-->/g, "")
    .replace(/(`+)[^]*?\1/g, "");
  const links: string[] = [];
  // Inline links/images and reference definitions. Anchor and network checks are
  // deliberately separate from this offline file-availability check.
  for (const match of prose.matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g)) {
    links.push(match[1] ?? match[2]!);
  }
  for (const match of prose.matchAll(/^ {0,3}\[(?!\^)[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm)) {
    links.push(match[1] ?? match[2]!);
  }
  for (const match of prose.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) links.push(match[1]!);
  return links;
}

export async function checkPublicDocs(root: string, candidatePaths: string[]): Promise<string[]> {
  const problems: string[] = [];
  const available = new Set<string>();
  for (const file of candidatePaths) {
    try {
      if ((await stat(path.join(root, file))).isFile()) {
        available.add(file);
        if (PRIVATE_DIRECTORY.test(file))
          problems.push(`${file}: private artifact included in Git`);
        if (INTERNAL_DOCS.test(file)) problems.push(`${file}: internal documentation is public`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Tracked deletions are expected while preparing a public snapshot.
    }
  }
  for (const file of available) {
    if (!publicMarkdown(file)) continue;
    for (const link of markdownFileLinks(await readFile(path.join(root, file), "utf8"))) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(link)) continue;
      let destination: string;
      try {
        destination = decodeURIComponent(link.split(/[?#]/, 1)[0]!);
      } catch {
        problems.push(`${file}: malformed link ${link}`);
        continue;
      }
      if (!destination) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), destination));
      if (
        destination.startsWith("/") ||
        target.startsWith("../") ||
        PRIVATE_DIRECTORY.test(target) ||
        INTERNAL_DOCS.test(target)
      ) {
        problems.push(`${file}: non-public link ${link}`);
      } else if (
        !available.has(target) &&
        ![...available].some((entry) => entry.startsWith(`${target.replace(/\/$/, "")}/`))
      ) {
        problems.push(`${file}: missing public target ${link}`);
      }
    }
  }
  return problems;
}

if (import.meta.main) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
  const problems = await checkPublicDocs(root, [...new Set(files)]);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      "Public Markdown file links and archive boundaries passed (no network/anchor checks).",
    );
  }
}
