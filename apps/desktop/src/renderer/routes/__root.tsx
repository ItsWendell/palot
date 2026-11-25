import { Outlet, createRootRouteWithContext, useRouterState } from "@tanstack/react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAtomValue, useSetAtom, useStore, type createStore } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PalotOpenTarget } from "../../shared";
import { attentionTargetAtom, markAttentionSeenAtom } from "../atoms/attention";
import { BrowserSessionManager } from "../components/browser-session-manager";
import { TaskActivityAnnouncer } from "../components/task-activity-announcer";
import { GlobalCommandPalette } from "../components/global-command-palette";
import { MoveToFolderRequestHost } from "../components/move-to-folder-dialog";
import { OnboardingController } from "../components/onboarding-controller";
import { ProjectScriptNotices } from "../components/project-script-notices";
import { SshPrompts } from "../components/ssh-prompts";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useWorkspaceController } from "../hooks/use-workspace";
import { useAutoSettle } from "../hooks/use-auto-settle";
import { useInboxController } from "../hooks/use-inbox-controller";
import { useAttentionNotifications } from "../hooks/use-attention-notifications";
import { palot } from "../services/palot";
import { showErrorToast } from "../lib/toast-error";
import { composerStateAtomFamily } from "../atoms/composer-state";
import { composerScope } from "../lib/composer-scope";
import { runtimeAtom } from "../atoms/workspace";
import { validateConnectionSearch } from "../lib/route-search";
import { focusConnection } from "../lib/connection-focus";
import { useConnectionOverviewController } from "../hooks/use-connection-overview";
import { connectionOverview } from "../lib/connection-overview";
import { resolveTaskLinkProfile } from "../lib/task-link-profile";

export interface RouterContext {
  queryClient: QueryClient;
  store: ReturnType<typeof createStore>;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  validateSearch: validateConnectionSearch,
  beforeLoad: async ({ context, search, preload, abortController }) => {
    if (search.profileID && !preload && !palot.isPreview()) {
      await focusConnection(
        context.queryClient,
        context.store,
        search.profileID,
        abortController.signal,
      );
    }
  },
  component: RuntimeLayout,
});

function RuntimeLayout() {
  const store = useStore();
  const queryClient = useQueryClient();
  const runtime = useAtomValue(runtimeAtom);
  useConnectionOverviewController();
  const markAttentionSeen = useSetAtom(markAttentionSeenAtom);
  const setAttentionTarget = useSetAtom(attentionTargetAtom);
  const { openNewTask, openSession, openSettings } = usePalotNavigation();
  const automaticOnboardingBlocked = useRef(false);
  const [initialTarget, setInitialTarget] = useState({ handled: false, allowAutomatic: false });
  const sessionID = useRouterState({
    select: (state) => {
      const value = state.matches
        .map((match) => match.params as { sessionID?: string })
        .find((params) => params.sessionID)?.sessionID;
      return typeof value === "string" ? value : null;
    },
  });
  const routeProfileID = useRouterState({ select: (state) => state.location.search.profileID });
  const openTarget = useCallback(
    (target: PalotOpenTarget) => {
      if (target.type === "open") return;
      if (target.type === "new-task") {
        void openNewTask();
        return;
      }
      if (target.type === "project") {
        const profileID = store.get(runtimeAtom)?.profileID;
        void palot
          .createSession(target.directory)
          .then((session) => {
            if (session) {
              if (target.files?.length)
                store.set(
                  composerStateAtomFamily(composerScope(profileID, `session:${session.id}`)),
                  (state) => ({
                    ...state,
                    files: target.files!,
                  }),
                );
              return openSession(session.id, { profileID });
            }
          })
          .catch((error) => showErrorToast("Could not open project", error));
        return;
      }
      if (target.type === "notification-settings") {
        void openSettings("notifications");
        return;
      }
      if (target.requestID && target.requestType) {
        markAttentionSeen(`${target.sessionID}:${target.requestType}:${target.requestID}`);
        setAttentionTarget({
          sessionID: target.sessionID,
          requestID: target.requestID,
          type: target.requestType,
        });
        void openSession(target.sessionID, {
          profileID: target.profileID,
          focus: "request",
          requestID: target.requestID,
          requestType: target.requestType,
        });
        return;
      }
      // Links and `--task` may name no profile, or one from another machine: find the task's.
      const profileID = resolveTaskLinkProfile(
        connectionOverview(queryClient).getSnapshot(),
        target.sessionID,
        target.profileID,
      );
      void openSession(target.sessionID, profileID ? { profileID } : {});
    },
    [
      markAttentionSeen,
      openNewTask,
      openSession,
      openSettings,
      queryClient,
      setAttentionTarget,
      store,
    ],
  );
  useEffect(() => {
    let active = true;
    void palot
      .takeOpenTarget()
      .then((target) => {
        if (target && target.type !== "open") automaticOnboardingBlocked.current = true;
        if (target) openTarget(target);
        if (active) {
          setInitialTarget({
            handled: true,
            allowAutomatic:
              (!target || target.type === "open") && !automaticOnboardingBlocked.current,
          });
        }
      })
      .catch(() => {
        if (active) {
          setInitialTarget({
            handled: true,
            allowAutomatic: !automaticOnboardingBlocked.current,
          });
        }
      });
    const unsubscribe = palot.onOpenTargetRequested((target) => {
      if (target.type !== "open") {
        automaticOnboardingBlocked.current = true;
        setInitialTarget({ handled: true, allowAutomatic: false });
      }
      void palot.takeOpenTarget();
      openTarget(target);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [openTarget]);
  return (
    <>
      <WorkspaceController
        key={runtime?.connectionID ?? "initial"}
        sessionID={routeProfileID && routeProfileID !== runtime?.profileID ? null : sessionID}
      />
      {runtime?.connected ? (
        <BrowserSessionManager
          key={JSON.stringify([runtime.connectionID, runtime.profileID])}
          connectionID={runtime.connectionID}
          profileID={runtime.profileID}
          sessionID={routeProfileID && routeProfileID !== runtime.profileID ? null : sessionID}
        />
      ) : null}
      <InboxController />
      <AttentionNotifications />
      <TaskActivityAnnouncer
        sessionID={routeProfileID && routeProfileID !== runtime?.profileID ? null : sessionID}
      />
      <ProjectScriptNotices />
      <OnboardingController
        initialTargetHandled={initialTarget.handled}
        allowAutomatic={initialTarget.allowAutomatic}
      />
      <Outlet />
      <GlobalCommandPalette />
      <MoveToFolderRequestHost />
      <SshPrompts />
    </>
  );
}

function WorkspaceController({ sessionID }: { sessionID: string | null }) {
  useWorkspaceController(sessionID);
  return null;
}

function InboxController() {
  useInboxController();
  useAutoSettle();
  return null;
}

/** Separate from the inbox's controller: it re-renders on every request change. */
function AttentionNotifications() {
  useAttentionNotifications();
  return null;
}
