/**
 * The text OpenCode wraps around a background result when it reports back to the session.
 * From 2.4.0 (#64971) every kind uses one tag, `<background-result kind="shell" id state command>`,
 * `<background-result kind="codemode" id state>` and `<background-result kind="subagent" sessionID
 * state description>` (also `image` and `video`); earlier servers send `<shell …>`,
 * `<codemode …>` and `<subagent …>`. The message metadata (`source`, `state`, `jobID`, …) is
 * the same in both, so the tag only matters for reading the body and its attributes.
 */
export type BackgroundResultKind = "shell" | "codemode" | "subagent" | "image" | "video";

export interface BackgroundResultTag {
  /** The tag's attributes, without `kind`. Values are raw: OpenCode doesn't escape them. */
  attributes: Record<string, string>;
  /** The opening tag with any leading whitespace and the newline after it. */
  opening: string;
}

export interface BackgroundResult extends BackgroundResultTag {
  /** The text between the tags, without the newlines OpenCode puts around it. */
  body: string;
}

const ATTRIBUTE = /([A-Za-z][\w-]*)="([^"]*)"/g;

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [, name, value] of source.matchAll(ATTRIBUTE)) attributes[name!] = value!;
  return attributes;
}

function openingTag(text: string, kind: BackgroundResultKind) {
  const match = text.match(/^\s*<(background-result|[a-z]+)\b([^>]*)>\n?/);
  if (!match) return null;
  const [opening, tag = "", source = ""] = match;
  const attributes = parseAttributes(source);
  if (tag === "background-result") {
    if (attributes.kind !== kind) return null;
    delete attributes.kind;
  } else if (tag !== kind) {
    return null;
  }
  return { tag, opening, attributes };
}

/** The opening tag of a `kind` result, in either form, when the text starts with one. */
export function backgroundResultTag(
  text: string,
  kind: BackgroundResultKind,
): BackgroundResultTag | null {
  const tag = openingTag(text, kind);
  return tag ? { opening: tag.opening, attributes: tag.attributes } : null;
}

/** A whole `kind` result, in either form: the text must be exactly one tagged block. */
export function parseBackgroundResult(
  text: string,
  kind: BackgroundResultKind,
): BackgroundResult | null {
  const tag = openingTag(text, kind);
  if (!tag) return null;
  const rest = text.slice(tag.opening.length);
  const close = rest.match(new RegExp(`\\n?</${tag.tag}>\\s*$`));
  if (!close || close.index === undefined) return null;
  return { opening: tag.opening, attributes: tag.attributes, body: rest.slice(0, close.index) };
}
