import { useRouter } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { Check, Copy } from "lucide-react";
import { runtimeAtom } from "../atoms/workspace";
import { useClipboardCopy } from "../hooks/use-clipboard-copy";
import {
  CLAUDE_AGENT_ID,
  CLAUDE_SIGN_IN_COMMAND,
  CLAUDE_UPDATE_COMMAND,
  claudeCodeFailure,
  type ClaudeCodeFailure,
} from "../lib/claude-agent-setup";
import { Button } from "./ui/button";

/**
 * Recovery for a reply that failed because Claude Code needs setup: open Claude Agent's
 * guided setup, or copy the command OpenCode's error names. Palot never runs it.
 */
export function ClaudeCodeFailureActions({ detail }: { detail: string | null | undefined }) {
  const failure = claudeCodeFailure(detail);
  return failure ? <ClaudeCodeFailureActionsContent failure={failure} /> : null;
}

function ClaudeCodeFailureActionsContent({ failure }: { failure: ClaudeCodeFailure }) {
  // Transcripts also render outside a router (previews, tests); setup links need one.
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | undefined;
  const profileID = useAtomValue(runtimeAtom)?.profileID;
  const { copiedKey, copy } = useClipboardCopy();
  const command = (value: string, key: string, label: string) => (
    <Button type="button" variant="ghost" size="sm" onClick={() => void copy(value, key)}>
      {copiedKey === key ? (
        <Check data-icon="inline-start" aria-hidden="true" />
      ) : (
        <Copy data-icon="inline-start" aria-hidden="true" />
      )}
      {copiedKey === key ? "Copied" : label}
    </Button>
  );

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {failure.signIn && router ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            void router.navigate({
              to: "/settings/providers",
              search: { ...(profileID ? { profileID } : {}), connect: CLAUDE_AGENT_ID },
            })
          }
        >
          Open Claude Agent setup
        </Button>
      ) : null}
      {failure.signIn ? command(CLAUDE_SIGN_IN_COMMAND, "sign-in", "Copy sign-in command") : null}
      {failure.update ? command(CLAUDE_UPDATE_COMMAND, "update", "Copy update command") : null}
    </div>
  );
}
