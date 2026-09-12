import type { JsonValue } from "../../shared";

export const STREAMING_PATCH_PAGE_SIZE = 128;
const BARE_PATCH_PREFIX = "*** Begin Patch";
const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

export interface StreamingPatchDocument {
  [key: string]: JsonValue;
  /** Exact decoded input, including the final newline when present. */
  text: string;
  /** Newline-terminated lines. Published pages are never mutated. */
  pages: string[][];
  lineCount: number;
  /** The current unterminated line, also retained after input ends. */
  tail: string;
  targetFiles: string[];
}

export interface StreamingPatchInputState {
  [key: string]: JsonValue;
  phase:
    | "detect"
    | "key-start"
    | "key"
    | "after-key"
    | "before-value"
    | "skip-string"
    | "patch"
    | "bare";
  prefix: string;
  key: string;
  escape: boolean;
  unicode: string;
  document: StreamingPatchDocument;
}

export function getStreamingPatchLineCount(document: StreamingPatchDocument): number {
  return document.lineCount + (document.tail.length > 0 ? 1 : 0);
}

export function getStreamingPatchLine(
  document: StreamingPatchDocument,
  index: number,
): string | undefined {
  if (index < 0 || index >= getStreamingPatchLineCount(document)) return undefined;
  if (index === document.lineCount) return document.tail;
  return document.pages[Math.floor(index / STREAMING_PATCH_PAGE_SIZE)]?.[
    index % STREAMING_PATCH_PAGE_SIZE
  ];
}

export function createStreamingPatchDocument(text = ""): StreamingPatchDocument {
  return appendPatchText(
    { text: "", pages: [], lineCount: 0, tail: "", targetFiles: [] },
    text,
    true,
  );
}

export function createStreamingPatchInputState(): StreamingPatchInputState {
  return {
    phase: "detect",
    prefix: "",
    key: "",
    escape: false,
    unicode: "",
    document: createStreamingPatchDocument(),
  };
}

/** This state is produced locally by the reducer, not decoded from a server payload. */
export function streamingPatchInputFromJson(
  value: JsonValue | undefined,
): StreamingPatchInputState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const document = value.document;
  if (!document || typeof document !== "object" || Array.isArray(document)) return null;
  return typeof value.phase === "string" && Array.isArray(document.pages)
    ? (value as StreamingPatchInputState)
    : null;
}

export function streamPatchInput(
  current: StreamingPatchInputState,
  chunk: string,
): StreamingPatchInputState {
  if (!chunk) return current;
  const state = { ...current };
  let decoded = "";
  let ended = false;
  const append = (character: string) => {
    decoded += character;
  };
  for (const character of chunk) {
    if (consume(state, character, append)) ended = true;
  }
  state.document = appendPatchText(current.document, decoded, ended);
  return state;
}

function patchTarget(line: string): string | undefined {
  const target =
    line.match(/^\*\*\* (?:Add|Delete|Update) File: (.+)$/)?.[1] ??
    line.match(/^\*\*\* Move to: (.+)$/)?.[1] ??
    line.match(/^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/)?.[2] ??
    line.match(/^Index: (.+)$/)?.[1];
  const file = target?.trim().replace(/^"|"$/g, "");
  return file && file !== "/dev/null" ? file : undefined;
}

function appendPatchText(
  current: StreamingPatchDocument,
  text: string,
  ended: boolean,
): StreamingPatchDocument {
  if (!text && !ended) return current;
  const document = { ...current, text: current.text + text };
  const addTarget = (line: string) => {
    const file = patchTarget(line.endsWith("\r") ? line.slice(0, -1) : line);
    if (!file || document.targetFiles.includes(file)) return;
    if (document.targetFiles === current.targetFiles) {
      document.targetFiles = [...current.targetFiles];
    }
    document.targetFiles.push(file);
  };
  let offset = 0;
  let newline = text.indexOf("\n");
  if (newline !== -1) {
    document.pages = [...current.pages];
    if (current.lineCount % STREAMING_PATCH_PAGE_SIZE !== 0) {
      document.pages[document.pages.length - 1] = [...document.pages.at(-1)!];
    }
  }
  // Scan only newly decoded text, never the existing text or growing tail.
  while (newline !== -1) {
    const line = document.tail + text.slice(offset, newline);
    if (document.lineCount % STREAMING_PATCH_PAGE_SIZE === 0) document.pages.push([]);
    document.pages.at(-1)!.push(line);
    document.lineCount += 1;
    document.tail = "";
    addTarget(line);
    offset = newline + 1;
    newline = text.indexOf("\n", offset);
  }
  document.tail += text.slice(offset);
  if (ended && document.tail) addTarget(document.tail);
  return document;
}

function consume(
  state: StreamingPatchInputState,
  character: string,
  append: (character: string) => void,
): boolean {
  if (state.phase === "detect") {
    if (!state.prefix && /\s/.test(character)) return false;
    state.prefix += character;
    if (BARE_PATCH_PREFIX.startsWith(state.prefix)) {
      if (state.prefix === BARE_PATCH_PREFIX) {
        state.phase = "bare";
        append(state.prefix);
        state.prefix = "";
      }
      return false;
    }
    state.phase = "key-start";
    state.prefix = "";
  }
  if (state.phase === "bare") {
    append(character);
    return false;
  }
  if (state.phase === "patch" || state.phase === "key" || state.phase === "skip-string") {
    const emit = (value: string) => {
      if (state.phase === "patch") append(value);
      else if (state.phase === "key") state.key += value;
    };
    if (state.unicode) {
      state.unicode += character;
      if (state.unicode.length === 5) {
        emit(String.fromCharCode(Number.parseInt(state.unicode.slice(1), 16)));
        state.unicode = "";
        state.escape = false;
      }
    } else if (state.escape) {
      if (character === "u") state.unicode = "u";
      else {
        emit(ESCAPES[character] ?? character);
        state.escape = false;
      }
    } else if (character === "\\") {
      state.escape = true;
    } else if (character === '"') {
      const ended = state.phase === "patch";
      state.phase = state.phase === "key" ? "after-key" : "key-start";
      return ended;
    } else emit(character);
    return false;
  }
  if (state.phase === "key-start") {
    if (character === '"') {
      state.phase = "key";
      state.key = "";
    }
  } else if (state.phase === "after-key") {
    if (character === ":") state.phase = "before-value";
    else if (!/\s/.test(character)) state.phase = "key-start";
  } else if (state.phase === "before-value") {
    if (/\s/.test(character)) return false;
    state.phase =
      character !== '"'
        ? "key-start"
        : state.key === "patchText" || state.key === "patch" || state.key === "diff"
          ? "patch"
          : "skip-string";
  }
  return false;
}
