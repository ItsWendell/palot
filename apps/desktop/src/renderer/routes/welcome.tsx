import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Cable,
  Check,
  CheckCircle2,
  CircleAlert,
  Folder,
  FolderPlus,
  LoaderCircle,
  Search,
} from "lucide-react";
import { useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LocationRef } from "@opencode/client";
import type { PalotIntegration, PalotSession, SettingsLocationInput } from "../../shared";
import {
  ONBOARDING_VERSION,
  onboardingComplete,
  onboardingCompletedProfilesAtom,
} from "../atoms/onboarding";
import { newTaskProjectIDAtom, runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { PalotBeacon } from "../components/palot-beacon";
import { OpenCodeReleaseSetup } from "../components/open-code-release-settings";
import { ProviderConnectionDialog } from "../components/provider-connection-dialog";
import { ProviderIcon } from "../components/ui/provider-icon";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { ScrollFadeArea } from "../components/ui/scroll-fade-area";
import { usePalotNavigation } from "../hooks/use-navigation";
import {
  useCacheSession,
  useProjectCatalog,
  useSessionCatalog,
} from "../hooks/use-session-catalog";
import { useSettingsSnapshot } from "../hooks/use-settings-snapshot";
import { cn } from "../lib/cn";
import { isPopularProvider, orderProviderIntegrations } from "../lib/provider-presentation";
import { orderProjects, projectLocation, projectName } from "../lib/view-models";
import { showErrorToast } from "../lib/toast-error";
import { palot } from "../services/palot";

export const Route = createFileRoute("/welcome")({
  component: WelcomeRoute,
});

type Step = "welcome" | "project" | "providers";
type Target = {
  connectionID: string;
  projectID: string;
  projectName: string;
  location: LocationRef;
  session: PalotSession | null;
};

function WelcomeRoute() {
  const store = useStore();
  const mounted = useRef(false);
  const runtime = useAtomValue(runtimeAtom);
  const projects = useProjectCatalog();
  const sessions = useSessionCatalog();
  const cacheSession = useCacheSession();
  const selectedSessionID = useAtomValue(selectedSessionIDAtom);
  const newTaskProjectID = useAtomValue(newTaskProjectIDAtom);
  const [completed, setCompleted] = useAtom(onboardingCompletedProfilesAtom);
  const { openNewTask, openSession } = usePalotNavigation();
  const [step, setStep] = useState<Step>("welcome");
  const [target, setTarget] = useState<Target | null>(null);
  const [connecting, setConnecting] = useState<PalotIntegration | null>(null);
  const [creating, setCreating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const [remotePath, setRemotePath] = useState("");
  const [showAllProviders, setShowAllProviders] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const visible = useMemo(() => orderProjects(projects, sessions), [projects, sessions]);
  const replay = Boolean(runtime && onboardingComplete(completed, runtime.profileID));
  const returning = projects.length > 0 || sessions.length > 0;
  const settingsInput: SettingsLocationInput | null = target
    ? {
        projectID: target.projectID,
        directory: target.location.directory,
        ...(target.location.workspaceID ? { workspaceID: target.location.workspaceID } : {}),
        capabilities: ["integrations"],
      }
    : null;
  const settings = useSettingsSnapshot(settingsInput, step === "providers");
  const integrations = useMemo(
    () => orderProviderIntegrations(settings.data?.integrations ?? []),
    [settings.data?.integrations],
  );
  const shownIntegrations = showAllProviders
    ? integrations
    : integrations.filter(
        (integration) => integration.connections.length > 0 || isPopularProvider(integration.id),
      );
  const connected = integrations.filter((integration) => integration.connections.length > 0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!target || target.connectionID === runtime?.connectionID) return;
    setTarget(null);
    setStep("project");
    setConnecting(null);
  }, [runtime?.connectionID, target]);

  function chooseExisting(projectID: string) {
    if (!runtime) return;
    const project = visible.find((candidate) => candidate.id === projectID);
    if (!project) return;
    setTarget({
      connectionID: runtime.connectionID,
      projectID: project.id,
      projectName: projectName(project),
      location: { directory: projectLocation(project) },
      session: null,
    });
    setStep("providers");
  }

  async function addDirectory(directory?: string) {
    if (!runtime || creating) return;
    const { connectionID, profileID } = runtime;
    const isCurrent = () => {
      const current = store.get(runtimeAtom);
      return (
        mounted.current && current?.connectionID === connectionID && current.profileID === profileID
      );
    };
    setCreating(true);
    try {
      const selected = directory ?? (await palot.pickDirectory());
      if (!selected || !mounted.current) return;
      const session = await palot.createSession(selected, undefined, connectionID);
      if (!session) return;
      cacheSession(session);
      if (!isCurrent()) return;
      setTarget({
        connectionID,
        projectID: session.projectID,
        projectName: directoryName(session.location.directory),
        location: session.location,
        session,
      });
      setRemotePath("");
      setStep("providers");
    } catch (error) {
      if (isCurrent()) showErrorToast("Could not add this project", error);
    } finally {
      if (mounted.current) setCreating(false);
    }
  }

  function markComplete() {
    if (!runtime) return;
    setCompleted((current) => ({ ...current, [runtime.profileID]: ONBOARDING_VERSION }));
  }

  async function completeAndNavigate(navigate: () => Promise<void>, fade = false) {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    if (fade) {
      setLeaving(true);
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
    }
    markComplete();
    try {
      await navigate();
    } catch (error) {
      setLeaving(false);
      showErrorToast("Could not open this project", error);
    } finally {
      finishingRef.current = false;
      setFinishing(false);
    }
  }

  async function finish(fade = false) {
    if (!target) return;
    await completeAndNavigate(
      () => (target.session ? openSession(target.session.id) : openNewTask(target.projectID)),
      fade,
    );
  }

  async function skipProject() {
    await completeAndNavigate(() => openNewTask());
  }

  async function leaveReplay() {
    if (selectedSessionID) {
      await openSession(selectedSessionID);
      return;
    }
    await openNewTask(newTaskProjectID ?? undefined);
  }

  return (
    <main
      className="palot-onboarding-surface @container/onboarding relative flex h-full min-h-0 flex-col overflow-hidden text-foreground"
      data-leaving={leaving}
    >
      <div className="window-drag absolute inset-x-0 top-0 z-10 h-[50px]" aria-hidden="true" />
      {replay ? (
        <Button
          className="window-no-drag absolute top-2 right-3 z-20"
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void leaveReplay()}
        >
          Back to Palot
        </Button>
      ) : null}

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 pt-16 pb-8 @3xl/onboarding:px-12 @3xl/onboarding:pt-20 @3xl/onboarding:pb-10">
        <section className="flex h-full min-h-0 w-full max-w-3xl max-h-[46rem] flex-col overflow-hidden">
          <div
            key={step}
            className="flex min-h-0 flex-1 animate-in flex-col fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
          >
            {step === "welcome" ? (
              <WelcomeStep
                returning={returning}
                projectCount={projects.length}
                taskCount={sessions.filter((session) => !session.parentID).length}
                onContinue={() => setStep("project")}
                local={
                  runtime?.source === "shared-service" || runtime?.profileID === "local-default"
                }
              />
            ) : null}
            {step === "project" ? (
              <ProjectStep
                projects={visible}
                localPaths={runtime?.capabilities?.localPathActions !== false}
                remotePath={remotePath}
                creating={creating}
                finishing={finishing}
                onRemotePathChange={setRemotePath}
                onBack={() => setStep("welcome")}
                onChoose={chooseExisting}
                onAdd={() => void addDirectory()}
                onAddRemote={() => void addDirectory(remotePath.trim())}
                onSkip={() => void skipProject()}
              />
            ) : null}
            {step === "providers" && target ? (
              <ProviderStep
                target={target}
                integrations={shownIntegrations}
                connected={connected}
                finishing={finishing}
                loading={settings.isPending}
                error={settings.error}
                canShowAll={shownIntegrations.length < integrations.length}
                onShowAll={() => setShowAllProviders(true)}
                onBack={() => setStep("project")}
                onConnect={setConnecting}
                onFinish={(fade) => void finish(fade)}
                onRetry={() => void settings.refetch()}
              />
            ) : null}
          </div>
          <StepIndicator step={step} />
        </section>
      </div>

      {target ? (
        <ProviderConnectionDialog
          key={connecting?.id ?? "closed"}
          integration={connecting}
          projectID={target.projectID}
          location={target.location}
          onOpenChange={(open) => !open && setConnecting(null)}
          onComplete={async () => {
            await settings.refetch();
          }}
        />
      ) : null}
    </main>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const active = ["welcome", "project", "providers"].indexOf(step);
  return (
    <div
      className="mt-7 flex shrink-0 justify-center gap-1.5"
      aria-label={`Step ${active + 1} of 3`}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            "h-1 rounded-full transition-[width,background-color] duration-200 motion-reduce:transition-none",
            index === active
              ? "w-8 bg-foreground"
              : index < active
                ? "w-4 bg-foreground/35"
                : "w-4 bg-foreground/10",
          )}
        />
      ))}
    </div>
  );
}

function WelcomeStep({
  returning,
  projectCount,
  taskCount,
  onContinue,
  local,
}: {
  returning: boolean;
  projectCount: number;
  taskCount: number;
  onContinue(): void;
  local: boolean;
}) {
  return (
    <div className="my-auto flex max-w-2xl flex-col items-start">
      <PalotBeacon className="mb-6 size-14" />
      <p className="mb-2 text-sm font-medium text-muted-foreground">Welcome to Palot</p>
      <h1 className="max-w-xl text-3xl/tight font-medium tracking-[-0.035em] @3xl/onboarding:text-4xl/tight">
        Your new home for OpenCode.
      </h1>
      <p className="mt-4 max-w-xl text-sm/relaxed text-muted-foreground">
        Palot gives OpenCode a focused desktop home for long-running work. Run tasks in isolated
        worktrees, follow their progress, review changes, and jump in whenever an agent needs you.
      </p>
      {local ? (
        <div className="mt-4">
          <OpenCodeReleaseSetup />
        </div>
      ) : null}
      {returning ? (
        <div className="mt-7 flex flex-wrap gap-2">
          <Badge variant="secondary">
            {projectCount} {projectCount === 1 ? "project" : "projects"}
          </Badge>
          <Badge variant="secondary">
            {taskCount} {taskCount === 1 ? "task" : "tasks"}
          </Badge>
          <Badge variant="outline">
            <Check className="size-3" aria-hidden="true" /> Existing OpenCode setup detected
          </Badge>
        </div>
      ) : null}
      <Button className="mt-9" type="button" onClick={onContinue}>
        Continue
        <ArrowRight data-icon="inline-end" aria-hidden="true" />
      </Button>
    </div>
  );
}

function ProjectStep({
  projects,
  localPaths,
  remotePath,
  creating,
  finishing,
  onRemotePathChange,
  onBack,
  onChoose,
  onAdd,
  onAddRemote,
  onSkip,
}: {
  projects: ReturnType<typeof orderProjects>;
  localPaths: boolean;
  remotePath: string;
  creating: boolean;
  finishing: boolean;
  onRemotePathChange(value: string): void;
  onBack(): void;
  onChoose(projectID: string): void;
  onAdd(): void;
  onAddRemote(): void;
  onSkip(): void;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? projects.filter((project) =>
        `${projectName(project)} ${projectLocation(project)}`.toLowerCase().includes(normalized),
      )
    : projects;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StepHeading
        eyebrow="Choose a project"
        title="Where should Palot start?"
        description="Recent projects appear first. Provider connections and models are resolved for the project you choose."
      />
      {projects.length > 5 ? (
        <div className="relative mt-6">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
            className="pl-9"
          />
        </div>
      ) : null}
      <ScrollFadeArea
        containerClassName="mt-6 min-h-0 flex-1"
        className="pr-1"
        data-onboarding-project-list
      >
        <div className="grid gap-2">
          {filtered.map((project) => (
            <button
              key={project.id}
              type="button"
              data-onboarding-project-name={projectName(project)}
              className="group flex w-full items-center gap-3 rounded-xl border border-border/75 bg-background/30 px-4 py-3 text-left backdrop-blur-sm outline-none transition-colors hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => onChoose(project.id)}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted/45">
                <Folder className="size-4 text-muted-foreground" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{projectName(project)}</span>
                <code dir="ltr" className="mt-0.5 block truncate text-meta text-muted-foreground">
                  {projectLocation(project)}
                </code>
              </span>
              <ArrowRight
                className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </button>
          ))}
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No projects match this search.
            </p>
          ) : null}
        </div>
      </ScrollFadeArea>
      <div className="mt-6 border-t pt-5">
        {localPaths ? (
          <Button type="button" variant="outline" disabled={creating} onClick={onAdd}>
            {creating ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <FolderPlus aria-hidden="true" />
            )}
            Add project folder
          </Button>
        ) : (
          <div className="flex gap-2">
            <Input
              value={remotePath}
              onChange={(event) => onRemotePathChange(event.target.value)}
              placeholder="/absolute/server/path"
              aria-label="Server project path"
            />
            <Button
              type="button"
              variant="outline"
              disabled={creating || !remotePath.trim()}
              onClick={onAddRemote}
            >
              {creating ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}Add
              path
            </Button>
          </div>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <Button type="button" variant="ghost" disabled={finishing} onClick={onSkip}>
          {finishing ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
          Skip for now
        </Button>
      </div>
    </div>
  );
}

function ProviderStep({
  target,
  integrations,
  connected,
  finishing,
  loading,
  error,
  canShowAll,
  onShowAll,
  onBack,
  onConnect,
  onFinish,
  onRetry,
}: {
  target: Target;
  integrations: PalotIntegration[];
  connected: PalotIntegration[];
  finishing: boolean;
  loading: boolean;
  error: Error | null;
  canShowAll: boolean;
  onShowAll(): void;
  onBack(): void;
  onConnect(integration: PalotIntegration): void;
  onFinish(fade?: boolean): void;
  onRetry(): void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StepHeading
        eyebrow={target.projectName}
        title="Connect your models"
        description="Palot uses OpenCode's provider connections. You can skip this if your environment is already configured."
      />
      {connected.length > 0 ? (
        <div className="mt-6 rounded-xl border border-border/75 bg-muted/10 p-3 backdrop-blur-sm">
          <div className="mb-2 text-xs font-medium">Connected already</div>
          <div className="flex flex-wrap gap-2">
            {connected.map((integration) => (
              <Badge key={integration.id} variant="secondary">
                <CheckCircle2 className="size-3 text-info" aria-hidden="true" />
                {integration.name}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
      <ScrollFadeArea containerClassName="mt-5 min-h-0 flex-1" className="pr-1">
        {loading ? (
          <div
            className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Loading providers from OpenCode…
          </div>
        ) : null}
        {error ? (
          <div
            className="rounded-xl border border-destructive/25 bg-destructive/5 p-4"
            role="alert"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <CircleAlert className="size-4 text-destructive" aria-hidden="true" />
              Providers could not be loaded
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              You can retry or continue without connecting one now.
            </p>
            <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : null}
        {!loading && !error ? (
          <div className="grid gap-2 @2xl/onboarding:grid-cols-2">
            {integrations.map((integration) => {
              const isConnected = integration.connections.length > 0;
              const connectable = integration.methods.some((method) => method.type !== "env");
              return (
                <button
                  key={integration.id}
                  type="button"
                  disabled={!connectable}
                  className="group flex min-h-14 items-center gap-3 rounded-xl border border-border/75 bg-background/30 px-3 py-2.5 text-left backdrop-blur-sm outline-none transition-colors enabled:hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-70"
                  onClick={() => onConnect(integration)}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/45">
                    <ProviderIcon id={integration.id} className="size-4 text-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{integration.name}</span>
                    <span className="block truncate text-meta text-muted-foreground">
                      {isConnected
                        ? `${integration.connections.length} connection${integration.connections.length === 1 ? "" : "s"}`
                        : connectable
                          ? "Connect with OpenCode"
                          : "Configured through the environment"}
                    </span>
                  </span>
                  {isConnected ? (
                    <CheckCircle2 className="size-4 text-info" aria-hidden="true" />
                  ) : connectable ? (
                    <Cable className="size-4 text-muted-foreground" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
        {canShowAll ? (
          <Button className="mt-3" type="button" variant="ghost" size="sm" onClick={onShowAll}>
            Show all providers
          </Button>
        ) : null}
      </ScrollFadeArea>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" disabled={finishing} onClick={() => onFinish()}>
            Skip provider setup
          </Button>
          <Button type="button" disabled={finishing} onClick={() => onFinish(true)}>
            {finishing ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            Start working
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>
      <h1 className="mt-2 text-2xl/tight font-medium tracking-[-0.025em]">{title}</h1>
      <p className="mt-2 max-w-xl text-sm/relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

function directoryName(directory: string) {
  return (
    directory
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) || directory
  );
}
