import { useInfiniteQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import type { PalotMessage } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { compareMessages } from "../lib/message-reconcile";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { transcriptPromptLabel, type TranscriptPrompt } from "../lib/transcript-outline";
import { loadPromptIndex } from "../services/opencode-resources";
import { projectTranscriptMessages } from "./use-session-transcript";

const NO_MESSAGES: PalotMessage[] = [];

export function useTranscriptPrompts(input: {
  sessionID: string;
  hasOlder: boolean;
  firstMessage: PalotMessage | undefined;
  loaded: readonly TranscriptPrompt[];
}) {
  const runtime = useAtomValue(runtimeAtom);
  const query = useInfiniteQuery({
    queryKey: openCodeKeys.promptIndex(runtime?.connectionID ?? "disconnected", input.sessionID),
    enabled: canFetchOpenCode(runtime) && input.hasOlder,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => loadPromptIndex(input.sessionID, pageParam, signal),
    getNextPageParam: (page, _pages, _last, params) => {
      const next = page.cursor.next;
      return next && !params.includes(next) ? next : undefined;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  // The prompts before the loaded transcript, read from the index without adding transcript pages.
  const olderMessages = useMemo(() => {
    if (!input.hasOlder || !input.firstMessage || !query.data) return NO_MESSAGES;
    const seen = new Set(input.loaded.map((prompt) => prompt.messageID));
    return projectTranscriptMessages(query.data.pages.flatMap((page) => page.data))
      .filter(
        (message) => message.type === "user" && compareMessages(message, input.firstMessage!) < 0,
      )
      .toSorted(compareMessages)
      .filter((message) => {
        if (seen.has(message.id)) return false;
        seen.add(message.id);
        return true;
      });
  }, [input.hasOlder, input.firstMessage, input.loaded, query.data]);
  const prompts = useMemo(
    () =>
      olderMessages.length === 0
        ? input.loaded
        : [
            ...olderMessages.map((message) => ({
              messageID: message.id,
              label: transcriptPromptLabel(message),
            })),
            ...input.loaded,
          ],
    [olderMessages, input.loaded],
  );
  return {
    prompts,
    olderMessages,
    earlier: {
      available: input.hasOlder && (query.hasNextPage || query.isError),
      loading: query.isFetching,
      failed: input.hasOlder && query.isError,
      async load() {
        const result = query.isError ? await query.refetch() : await query.fetchNextPage();
        return !result.isError;
      },
    },
  };
}
