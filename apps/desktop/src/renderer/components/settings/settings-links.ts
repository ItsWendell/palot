import { useRouter } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useCallback, useSyncExternalStore } from "react";
import { runtimeAtom } from "../../atoms/workspace";

type AppRouter = ReturnType<typeof useRouter>;

/**
 * The router, when there is one. Settings sections also render in isolation (tests,
 * previews), where cross-page links are unavailable rather than an error.
 */
function useOptionalRouter(): AppRouter | undefined {
  return useRouter({ warn: false }) as AppRouter | undefined;
}

/** Links between the Models and Providers pages, keeping the settings project. */
export function useModelProviderLinks(projectID: string) {
  const router = useOptionalRouter();
  const profileID = useAtomValue(runtimeAtom)?.profileID;
  return {
    available: Boolean(router),
    openModels(provider?: string) {
      void router?.navigate({
        to: "/settings/models",
        search: { projectID, profileID, ...(provider ? { provider } : {}) },
      });
    },
    openProviders() {
      void router?.navigate({ to: "/settings/providers", search: { projectID, profileID } });
    },
  };
}

/** The `provider` search parameter of the Models page (`#/settings/models?provider=openai`). */
export function useModelsProviderParam(): string | undefined {
  const router = useOptionalRouter();
  const subscribe = useCallback(
    (notify: () => void) => router?.subscribe("onResolved", notify) ?? (() => {}),
    [router],
  );
  return useSyncExternalStore(subscribe, () => {
    const search = router?.state.location.search as Record<string, unknown> | undefined;
    return typeof search?.provider === "string" && search.provider ? search.provider : undefined;
  });
}
