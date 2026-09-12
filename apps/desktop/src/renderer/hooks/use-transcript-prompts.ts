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
  const prompts = useMemo(() => {
    if (!input.hasOlder || !input.firstMessage || !query.data) return input.loaded;
    const seen = new Set(input.loaded.map((prompt) => prompt.messageID));
    const older = projectTranscriptMessages(query.data.pages.flatMap((page) => page.data))
      .filter(
        (message) => message.type === "user" && compareMessages(message, input.firstMessage!) < 0,
      )
      .toSorted(compareMessages)
      .flatMap((message) => {
        if (seen.has(message.id)) return [];
        seen.add(message.id);
        return [{ messageID: message.id, label: transcriptPromptLabel(message) }];
      });
    return [...older, ...input.loaded];
  }, [input.hasOlder, input.firstMessage, input.loaded, query.data]);
  return {
    prompts,
    earlier: {
      available: input.hasOlder && (query.hasNextPage || query.isError),
      loading: query.isFetching,
      async load() {
        const result = query.isError ? await query.refetch() : await query.fetchNextPage();
        return !result.isError;
      },
    },
  };
}
