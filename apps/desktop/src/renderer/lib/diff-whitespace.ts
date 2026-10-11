/**
 * Hide whitespace changes in a unified patch, client side.
 *
 * OpenCode's `vcs.diff`/`session.diff` have no whitespace option, and
 * `@pierre/diffs` `parseDiffOptions` only applies when it computes a diff from file
 * contents, not to supplied patches. So this rewrites the patch text instead, with
 * `git diff -w` semantics inside each change block: a removed line and an added line
 * that differ only in whitespace become one context line showing the new text.
 *
 * Pairs come from a longest common subsequence over the block's whitespace-stripped
 * lines, so both hunk line counts stay valid and line numbers stay correct. Hunks
 * left with no changes are dropped. Added or removed blank lines remain changes,
 * as they do with `git diff -w`.
 */

import type { FileDiffInfo } from "@opencode/client";

export interface WhitespaceFilteredPatch {
  patch: string;
  additions: number;
  deletions: number;
  /** True when the patch had changes and every one of them was whitespace. */
  whitespaceOnly: boolean;
}

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
/** Larger change blocks keep their lines rather than spend quadratic time pairing them. */
const MAX_PAIRING_CELLS = 250_000;

export function hideWhitespaceChanges(patch: string): WhitespaceFilteredPatch {
  const lines = patch.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let additions = 0;
  let deletions = 0;
  let hunks = 0;
  let keptHunks = 0;
  let rewritten = false;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const header = HUNK_HEADER.exec(line);
    if (!header) {
      output.push(line);
      index += 1;
      continue;
    }
    hunks += 1;
    let oldLeft = header[1] === undefined ? 1 : Number(header[1]);
    let newLeft = header[2] === undefined ? 1 : Number(header[2]);
    const body: string[] = [];
    index += 1;
    while (index < lines.length) {
      const next = lines[index]!;
      const marker = next[0];
      if (marker === "\\") {
        body.push(next);
      } else if (oldLeft <= 0 && newLeft <= 0) {
        break;
      } else if (marker === "-") {
        oldLeft -= 1;
        body.push(next);
      } else if (marker === "+") {
        newLeft -= 1;
        body.push(next);
      } else if (marker === " " || next === "") {
        oldLeft -= 1;
        newLeft -= 1;
        body.push(next);
      } else {
        break;
      }
      index += 1;
    }
    const filtered = filterHunkBody(body);
    if (filtered.rewritten) rewritten = true;
    if (filtered.additions === 0 && filtered.deletions === 0) {
      rewritten = true;
      continue;
    }
    keptHunks += 1;
    additions += filtered.additions;
    deletions += filtered.deletions;
    output.push(line, ...filtered.lines);
  }
  return {
    patch: rewritten ? output.join("\n") : patch,
    additions,
    deletions,
    whitespaceOnly: hunks > 0 && keptHunks === 0,
  };
}

function filterHunkBody(body: readonly string[]): {
  lines: string[];
  additions: number;
  deletions: number;
  rewritten: boolean;
} {
  const lines: string[] = [];
  let additions = 0;
  let deletions = 0;
  let rewritten = false;
  let index = 0;
  while (index < body.length) {
    const line = body[index]!;
    if (line[0] !== "-" && line[0] !== "+") {
      lines.push(line);
      index += 1;
      continue;
    }
    const start = index;
    while (index < body.length && /^[-+\\]/.test(body[index]!)) index += 1;
    const block = body.slice(start, index);
    const paired = pairWhitespaceChanges(block);
    if (paired) rewritten = true;
    for (const entry of paired ?? block) {
      if (entry[0] === "+") additions += 1;
      else if (entry[0] === "-") deletions += 1;
      lines.push(entry);
    }
  }
  return { lines, additions, deletions, rewritten };
}

/** Returns the rewritten block, or null when nothing in it is a whitespace-only change. */
function pairWhitespaceChanges(block: readonly string[]): string[] | null {
  // "\ No newline at end of file" ties a line to the file end; keep such blocks as-is.
  if (block.some((line) => line[0] === "\\")) return null;
  const removed = block.filter((line) => line[0] === "-").map((line) => line.slice(1));
  const added = block.filter((line) => line[0] === "+").map((line) => line.slice(1));
  if (removed.length === 0 || added.length === 0) return null;
  if (removed.length * added.length > MAX_PAIRING_CELLS) return null;
  const pairs = commonLines(removed.map(stripWhitespace), added.map(stripWhitespace));
  if (pairs.length === 0) return null;
  const lines: string[] = [];
  let removedAt = 0;
  let addedAt = 0;
  const flush = (removedEnd: number, addedEnd: number) => {
    for (; removedAt < removedEnd; removedAt += 1) lines.push(`-${removed[removedAt]}`);
    for (; addedAt < addedEnd; addedAt += 1) lines.push(`+${added[addedAt]}`);
  };
  for (const [removedIndex, addedIndex] of pairs) {
    flush(removedIndex, addedIndex);
    lines.push(` ${added[addedIndex]}`);
    removedAt += 1;
    addedAt += 1;
  }
  flush(removed.length, added.length);
  return lines;
}

function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}

/** Index pairs of a longest common subsequence, in order. */
function commonLines(left: readonly string[], right: readonly string[]): Array<[number, number]> {
  const width = right.length + 1;
  const lengths = new Uint32Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        left[i] === right[j]
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

export interface PresentedFileDiff {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  whitespaceOnly: boolean;
}

const presented = new WeakMap<FileDiffInfo, PresentedFileDiff>();

/** The diff as displayed: unchanged, or with whitespace-only changes folded into context. */
export function presentFileDiff(file: FileDiffInfo, hideWhitespace: boolean): PresentedFileDiff {
  if (!hideWhitespace || !file.patch) {
    return {
      file: file.file,
      patch: file.patch,
      additions: file.additions,
      deletions: file.deletions,
      whitespaceOnly: false,
    };
  }
  const cached = presented.get(file);
  if (cached) return cached;
  const filtered = hideWhitespaceChanges(file.patch);
  const value =
    filtered.patch === file.patch
      ? {
          file: file.file,
          patch: file.patch,
          additions: file.additions,
          deletions: file.deletions,
          whitespaceOnly: false,
        }
      : { file: file.file, ...filtered };
  presented.set(file, value);
  return value;
}
