import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { onboardingComplete, onboardingCompletedVersionAtom } from "../atoms/onboarding";
import { phaseAtom, runtimeAtom } from "../atoms/workspace";
import { useProjectCatalogState } from "../hooks/use-session-catalog";
import { palot } from "../services/palot";

export function OnboardingController({
  initialTargetHandled,
  allowAutomatic,
}: {
  initialTargetHandled: boolean;
  allowAutomatic: boolean;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Navigating during an unfinished router load (the launch redirect to /new) is lost: the
  // pending load commits afterwards and replaces /welcome.
  const routerIdle = useRouterState({ select: (state) => state.status === "idle" });
  const phase = useAtomValue(phaseAtom);
  const runtime = useAtomValue(runtimeAtom);
  const completed = useAtomValue(onboardingCompletedVersionAtom);
  const projects = useProjectCatalogState();
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current) return;
    // Leaving the launch surface is user intent, even while startup is still pending.
    if (pathname !== "/" && pathname !== "/new") {
      decided.current = true;
      return;
    }
    if (!initialTargetHandled) return;
    if (!allowAutomatic || palot.isPreview() || onboardingComplete(completed)) {
      decided.current = true;
      return;
    }
    if (phase !== "ready" || !runtime?.connected || !projects.ready || !routerIdle) return;
    decided.current = true;
    void navigate({ to: "/welcome", replace: true });
  }, [
    allowAutomatic,
    completed,
    initialTargetHandled,
    navigate,
    pathname,
    phase,
    projects.ready,
    routerIdle,
    runtime,
  ]);

  return null;
}
