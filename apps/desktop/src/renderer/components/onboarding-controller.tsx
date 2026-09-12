import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { onboardingComplete, onboardingCompletedProfilesAtom } from "../atoms/onboarding";
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
  const phase = useAtomValue(phaseAtom);
  const runtime = useAtomValue(runtimeAtom);
  const completed = useAtomValue(onboardingCompletedProfilesAtom);
  const projects = useProjectCatalogState();

  useEffect(() => {
    if (!initialTargetHandled || !allowAutomatic || palot.isPreview()) return;
    if (phase !== "ready" || !runtime?.connected || !projects.ready) return;
    if (pathname === "/welcome" || onboardingComplete(completed, runtime.profileID)) return;
    void navigate({ to: "/welcome", replace: true });
  }, [
    allowAutomatic,
    completed,
    initialTargetHandled,
    navigate,
    pathname,
    phase,
    projects.ready,
    runtime,
  ]);

  return null;
}
