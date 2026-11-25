import type { LocationRef } from "@opencode/client";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { runtimeAtom } from "../atoms/workspace";
import { parseGeneratedAttributes, type GeneratedAttributeRule } from "../lib/changed-file-kind";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { palot } from "../services/palot";

const NO_RULES: readonly GeneratedAttributeRule[] = [];
/** A root `.gitattributes` worth reading is small; skip anything larger. */
const MAX_BYTES = 64 * 1024;
/** The file rarely changes while a review is open; read it again after a few minutes. */
const STALE_MS = 5 * 60_000;

/**
 * `linguist-generated` rules from the workspace's root `.gitattributes`. One small read,
 * shared by every view of the workspace; a missing or unreadable file means no rules.
 */
export function useGeneratedAttributes(
  location: LocationRef,
  enabled: boolean,
): readonly GeneratedAttributeRule[] {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const query = useQuery({
    queryKey: [...openCodeKeys.file(connectionID, location, ".gitattributes"), "linguist"],
    queryFn: async ({ signal }) => {
      try {
        const bytes = await palot.readWorkspaceFile(
          { ...location, path: ".gitattributes" },
          signal,
          connectionID,
        );
        if (bytes.byteLength > MAX_BYTES) return NO_RULES;
        const rules = parseGeneratedAttributes(new TextDecoder().decode(bytes));
        return rules.length > 0 ? rules : NO_RULES;
      } catch (error) {
        if (signal.aborted) throw error;
        // Most projects have no .gitattributes; that is an answer, not a failure.
        return NO_RULES;
      }
    },
    enabled: enabled && canFetchOpenCode(runtime) && Boolean(location.directory),
    staleTime: STALE_MS,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return useMemo(() => query.data ?? NO_RULES, [query.data]);
}
