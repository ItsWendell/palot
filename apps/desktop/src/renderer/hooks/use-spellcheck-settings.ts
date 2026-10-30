import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PalotSpellcheckApi,
  SpellcheckSettings,
  SpellcheckUpdate,
} from "../../shared/spellcheck-contract";

const spellcheckKey = ["spellcheck-settings"] as const;

/** The desktop bridge, or undefined in a renderer preview. */
export function spellcheckBridge(): PalotSpellcheckApi | undefined {
  return typeof window === "undefined" ? undefined : window.palot?.spellcheck;
}

export function useSpellcheckSettings() {
  const api = spellcheckBridge();
  return useQuery({
    queryKey: spellcheckKey,
    queryFn: () => api!.load(),
    enabled: api !== undefined,
  });
}

/** Applies immediately and rolls back when main rejects the change. */
export function useUpdateSpellcheckSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (update: SpellcheckUpdate) => {
      const api = spellcheckBridge();
      if (!api) throw new Error("Spelling settings are only available in the Palot desktop app.");
      return api.update(update);
    },
    onMutate: async (update) => {
      await client.cancelQueries({ queryKey: spellcheckKey });
      const previous = client.getQueryData<SpellcheckSettings>(spellcheckKey);
      if (previous) {
        client.setQueryData<SpellcheckSettings>(
          spellcheckKey,
          "enabled" in update
            ? { ...previous, enabled: update.enabled }
            : update.languages
              ? { ...previous, languages: update.languages, followsSystem: false }
              : previous,
        );
      }
      return { previous };
    },
    onError: (_error, _update, context) => {
      if (context?.previous) client.setQueryData(spellcheckKey, context.previous);
    },
    onSuccess: (settings) => client.setQueryData(spellcheckKey, settings),
  });
}
