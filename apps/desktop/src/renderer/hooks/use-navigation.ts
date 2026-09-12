import { useNavigate, useRouter } from "@tanstack/react-router";
import { useStore } from "jotai";
import { useCallback } from "react";
import { newTaskProjectIDAtom, selectedSessionIDAtom, runtimeAtom } from "../atoms/workspace";
import { usageRangeAtom } from "../atoms/ui";
import type { SettingsCategory } from "../lib/settings-navigation";
import type { SessionRouteSearch, UsageRouteSearch } from "../lib/route-search";

export function usePalotNavigation() {
  const navigate = useNavigate();
  const router = useRouter();
  const store = useStore();
  const sessionDestination = useCallback(
    (sessionID: string) => ({ to: "/sessions/$sessionID", params: { sessionID } }) as const,
    [],
  );
  const openSession = useCallback(
    (sessionID: string, search: SessionRouteSearch = {}) => {
      return navigate({
        ...sessionDestination(sessionID),
        search: { profileID: store.get(runtimeAtom)?.profileID, ...search },
      });
    },
    [navigate, sessionDestination, store],
  );
  const preloadSession = useCallback(
    (sessionID: string, profileID?: string) =>
      router
        .preloadRoute({
          ...sessionDestination(sessionID),
          search: { profileID: profileID ?? store.get(runtimeAtom)?.profileID },
        })
        .then(() => undefined),
    [router, sessionDestination, store],
  );
  const openNewTask = useCallback(
    (projectID?: string, profileID?: string) =>
      navigate({
        to: "/new",
        search: { projectID, profileID: profileID ?? store.get(runtimeAtom)?.profileID },
      }),
    [navigate, store],
  );
  const openSettings = useCallback(
    (category: SettingsCategory = "general", projectID?: string, replace = false) =>
      navigate({
        to: category === "connections" ? "/settings/connections/profiles" : `/settings/${category}`,
        search: { projectID, profileID: store.get(runtimeAtom)?.profileID },
        replace,
      }),
    [navigate, store],
  );
  const openScheduled = useCallback(
    (
      search: {
        automationID?: string;
        runID?: string;
        mode?: "create";
        sessionID?: string;
        profileID?: string;
      } = {},
    ) =>
      navigate({
        to: "/scheduled",
        search: { profileID: store.get(runtimeAtom)?.profileID, ...search },
      }),
    [navigate, store],
  );
  const openUsage = useCallback(
    (search: Partial<UsageRouteSearch> = {}) =>
      navigate({
        to: "/usage",
        search: {
          days: search.days ?? store.get(usageRangeAtom),
          profileID: store.get(runtimeAtom)?.profileID,
          ...search,
        },
      }),
    [navigate, store],
  );
  const openWorktrees = useCallback(
    (projectID?: string) =>
      navigate({
        to: "/worktrees",
        search: { projectID, profileID: store.get(runtimeAtom)?.profileID },
      }),
    [navigate, store],
  );
  const openWelcome = useCallback(() => navigate({ to: "/welcome" }), [navigate]);
  const closeSettings = useCallback(() => {
    const sessionID = store.get(selectedSessionIDAtom);
    if (sessionID)
      return navigate({
        ...sessionDestination(sessionID),
        search: { profileID: store.get(runtimeAtom)?.profileID },
      });
    const projectID = store.get(newTaskProjectIDAtom);
    return navigate({
      to: "/new",
      search: { projectID: projectID ?? undefined, profileID: store.get(runtimeAtom)?.profileID },
    });
  }, [navigate, sessionDestination, store]);
  return {
    closeSettings,
    openNewTask,
    openSession,
    openScheduled,
    openSettings,
    openUsage,
    openWelcome,
    openWorktrees,
    preloadSession,
  };
}
