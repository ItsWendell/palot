import type { WorkbenchScope, WorkbenchState, WorkbenchTab } from "./workbench-tabs";
import { workbenchScopeKey } from "./workbench-tabs";
import type { ComposerDraft } from "./composer-draft";

export type BtwTab = Extract<WorkbenchTab, { kind: "btw" }>;

// Keep this aligned with OpenCode's built-in BTW extension. The public generation
// endpoint uses session context without executing tools or writing transcript turns.
const instructions = [
  "The user is asking a quick side question about the conversation so far.",
  "Answer directly and concisely in markdown from what you already know.",
  "Do not call any tools and do not take any actions.",
].join(" ");

export function btwPrompt(question: string): string {
  return `${instructions}\n\n${question}`;
}

/** null means a normal submission; an empty string is a BTW missing its question. */
export function parseBtwQuestion(text: string): string | null {
  const match = /^\s*\/btw(?:\s+([\s\S]*))?$/i.exec(text);
  return match ? (match[1] ?? "").trim() : null;
}

/** Side questions consume text, not file/skill context intended for a normal turn. */
export function draftAfterBtw(draft: ComposerDraft): ComposerDraft {
  let text = "";
  const mentions = draft.mentions.map((mention) => {
    if (text) text += " ";
    const start = text.length;
    text += mention.text;
    return { ...mention, start, end: text.length };
  });
  return { text, mentions, command: null };
}

export function findBtwTab(
  state: WorkbenchState,
  scope: WorkbenchScope,
  tabID: string,
): BtwTab | undefined {
  const context = state.scopes[workbenchScopeKey(scope)];
  return (
    context &&
    [...context.right.tabs, ...context.bottom.tabs].find(
      (tab): tab is BtwTab =>
        tab.kind === "btw" &&
        tab.id === tabID &&
        tab.resource.profileID === scope.profileID &&
        tab.resource.sessionID === scope.sessionID,
    )
  );
}

export function updateBtwTab(
  state: WorkbenchState,
  scope: WorkbenchScope,
  tabID: string,
  update: (tab: BtwTab) => BtwTab,
): WorkbenchState {
  if (!findBtwTab(state, scope, tabID)) return state;
  const key = workbenchScopeKey(scope);
  const context = state.scopes[key]!;
  const pane = context.right.tabs.some((tab) => tab.id === tabID) ? "right" : "bottom";
  return {
    ...state,
    scopes: {
      ...state.scopes,
      [key]: {
        ...context,
        [pane]: {
          ...context[pane],
          tabs: context[pane].tabs.map((tab) =>
            tab.kind === "btw" && tab.id === tabID ? update(tab) : tab,
          ),
        },
      },
    },
  };
}
