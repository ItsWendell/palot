/** Project-aware draft screen that creates an OpenCode session on first submit. */

import { useAtom, useAtomValue, useStore } from "jotai";
import { Check, ChevronDown, FolderGit2, GitBranch } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PalotProject, PalotSession } from "../../shared";
import { defaultWorktreeBaseAtom, defaultWorkspaceModeAtom } from "../atoms/ui";
import { approvalPresetRules } from "../lib/session-permissions";
import { createSessionInWorkspace, type WorkspaceSelection } from "../lib/new-session-workspace";
import { runtimeAtom } from "../atoms/workspace";
import { orderProjects, projectLocation, projectName, visibleProjects } from "../lib/view-models";
import { useVcsBranches, useVcsInfo } from "../hooks/use-vcs-info";
import {
  useCacheSession,
  useProjectCatalog,
  useSessionCatalog,
} from "../hooks/use-session-catalog";
import { palot } from "../services/palot";
import { Composer, type NewSessionComposerOptions } from "./composer";
import { ConnectionDestination } from "./connection-destination";
import { ProjectSelect } from "./project-select";
import { PalotBeacon } from "./palot-beacon";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover";

const EMPTY_TOKENS = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};

function selectableProjects(projects: PalotProject[]): PalotProject[] {
  const local = visibleProjects(projects).filter((project) => {
    const directory = projectLocation(project);
    return directory && directory !== "/";
  });
  return local.length > 0 ? local : projects;
}

function WorkspacePicker({
  project,
  selection,
  onSelect,
}: {
  project: PalotProject;
  selection: WorkspaceSelection;
  onSelect(selection: WorkspaceSelection): void;
}) {
  const [open, setOpen] = useState(false);
  const label = selection.type === "create" ? "New worktree" : "Current checkout";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="context"
            className="max-w-48"
            aria-label={`Work in: ${label}`}
            title={label}
          />
        }
      >
        <FolderGit2 className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">
          {selection.type === "create" ? "New worktree" : "Checkout"}
        </span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-1 p-1.5">
        <PopoverHeader className="px-2 py-1">
          <PopoverTitle>Work in</PopoverTitle>
          <PopoverDescription>Choose where OpenCode creates this task.</PopoverDescription>
        </PopoverHeader>
        <WorkspaceOption
          title="New worktree"
          description="Start detached from the current HEAD"
          active={selection.type === "create"}
          onClick={() => {
            onSelect({ type: "create" });
            setOpen(false);
          }}
        />
        <WorkspaceOption
          title="Current checkout"
          description="Use the project folder directly"
          active={selection.type === "current"}
          onClick={() => {
            onSelect({ type: "current", directory: project.canonical });
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function WorkspaceOption({
  title,
  description,
  active,
  onClick,
}: {
  title: string;
  description: string;
  active: boolean;
  onClick(): void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto w-full justify-start gap-2 px-2.5 py-2 text-left"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs font-normal text-muted-foreground">
          {description}
        </span>
      </span>
      {active ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
    </Button>
  );
}

function BranchPicker({
  branches,
  value,
  search,
  onSearchChange,
  onSelect,
}: {
  branches: string[];
  value: string;
  search: string;
  onSearchChange(value: string): void;
  onSelect(branch: string): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="context"
            className="max-w-52"
            aria-label={`Source branch: ${value}`}
          />
        }
      >
        <GitBranch className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{value}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-1 p-1.5">
        <PopoverHeader className="px-2 py-1">
          <PopoverTitle>Source branch</PopoverTitle>
          <PopoverDescription>Choose the ref for the new detached worktree.</PopoverDescription>
        </PopoverHeader>
        <Input
          type="search"
          value={search}
          placeholder="Search branches"
          aria-label="Search branches"
          className="mb-1 h-8"
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <div className="max-h-64 overflow-y-auto">
          {branches.map((branch) => (
            <Button
              key={branch}
              type="button"
              variant="ghost"
              className="h-8 w-full justify-start px-2 text-xs"
              onClick={() => {
                onSelect(branch);
                setOpen(false);
              }}
            >
              <span className="truncate">{branch}</span>
              {branch === value ? <Check className="ml-auto size-3.5" aria-hidden="true" /> : null}
            </Button>
          ))}
          {branches.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              No matching branches
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function NewTask({
  projectID: selectedProjectID = null,
  onProjectChange,
  onSessionCreated,
}: {
  projectID?: string | null;
  onProjectChange?(projectID: string): void;
  onSessionCreated?(sessionID: string): void;
} = {}) {
  const projects = useProjectCatalog();
  const sessions = useSessionCatalog();
  const taskProjects = useMemo(
    () => selectableProjects(orderProjects(projects, sessions)),
    [projects, sessions],
  );
  const selectProject = useCallback(
    (projectID: string) => onProjectChange?.(projectID),
    [onProjectChange],
  );
  const cacheSession = useCacheSession();
  const store = useStore();
  const runtime = useAtomValue(runtimeAtom);
  const defaultWorktreeBase = useAtomValue(defaultWorktreeBaseAtom);
  const [defaultWorkspaceMode, setDefaultWorkspaceMode] = useAtom(defaultWorkspaceModeAtom);
  const selectedProject =
    taskProjects.find((project) => project.id === selectedProjectID) ?? taskProjects[0] ?? null;
  const workspaceIdentity = selectedProject ? `${selectedProject.id}\0${defaultWorkspaceMode}` : "";
  const [workspaceOverride, setWorkspaceOverride] = useState<{
    identity: string;
    selection: WorkspaceSelection;
  } | null>(null);
  const workspaceSelection = useMemo<WorkspaceSelection>(
    () =>
      workspaceOverride?.identity === workspaceIdentity
        ? workspaceOverride.selection
        : defaultWorkspaceMode === "current" && selectedProject
          ? { type: "current", directory: selectedProject.canonical }
          : { type: "create" },
    [defaultWorkspaceMode, selectedProject, workspaceIdentity, workspaceOverride],
  );
  const [creationErrorState, setCreationErrorState] = useState<{
    identity: string;
    message: string;
  } | null>(null);
  const creationError =
    creationErrorState?.identity === workspaceIdentity ? creationErrorState.message : null;
  const [draftCreatedAt] = useState(() => Date.now());
  const [branchSearch, setBranchSearch] = useState("");
  const sourceBranchQuery = useVcsInfo(
    selectedProject ? { directory: selectedProject.canonical } : null,
  );
  const currentBranch = sourceBranchQuery.data?.currentBranch ?? null;
  const sourceBranch =
    defaultWorktreeBase === "repository-default"
      ? (sourceBranchQuery.data?.defaultBranch ?? currentBranch)
      : (currentBranch ?? sourceBranchQuery.data?.defaultBranch ?? null);
  const branchesQuery = useVcsBranches(
    selectedProject ? { directory: selectedProject.canonical } : null,
    branchSearch,
  );
  const branches = branchesQuery.data ?? [];
  const selectedSourceBranch =
    workspaceSelection.type === "create"
      ? (workspaceSelection.branch ?? sourceBranch)
      : sourceBranch;
  const branchOptions = selectedSourceBranch
    ? [selectedSourceBranch, ...branches.filter((branch) => branch !== selectedSourceBranch)]
    : branches;

  useEffect(() => {
    if (selectedProject && selectedProject.id !== selectedProjectID) {
      // NewTask canonicalizes a missing or invalid project selection in the owning route.
      // eslint-disable-next-line react-doctor/no-pass-data-to-parent
      onProjectChange?.(selectedProject.id);
    }
  }, [onProjectChange, selectedProject, selectedProjectID]);

  const draftSession = useMemo<PalotSession | null>(() => {
    if (!selectedProject) return null;
    return {
      id: `new:${selectedProject.id}`,
      parentID: null,
      projectID: selectedProject.id,
      title: null,
      agent: null,
      model: null,
      location: { directory: selectedProject.canonical },
      createdAt: draftCreatedAt,
      updatedAt: draftCreatedAt,
      archivedAt: null,
      cost: null,
      tokens: EMPTY_TOKENS,
    };
  }, [draftCreatedAt, selectedProject]);

  const createSession = useCallback(
    async ({ approvalMode, agent, model }: NewSessionComposerOptions) => {
      if (!selectedProject || !draftSession) return null;
      const assertConnection = () => {
        const current = store.get(runtimeAtom);
        if (
          current?.connectionID !== runtime?.connectionID ||
          current?.profileID !== runtime?.profileID
        ) {
          throw new Error("The server connection changed. Try creating the task again.");
        }
      };
      assertConnection();
      setCreationErrorState(null);
      let created: PalotSession | null;
      try {
        created = await createSessionInWorkspace({
          project: selectedProject,
          selection:
            workspaceSelection.type === "create" && selectedSourceBranch
              ? { type: "create", branch: selectedSourceBranch }
              : workspaceSelection,
          createCopy: palot.createProjectCopy,
          createSession: (directory) => {
            assertConnection();
            return palot.createSession(
              directory,
              undefined,
              runtime?.connectionID,
              approvalPresetRules(approvalMode),
            );
          },
        });
      } catch (error) {
        setCreationErrorState({
          identity: workspaceIdentity,
          message: error instanceof Error ? error.message : "Could not create this task.",
        });
        throw error;
      }
      if (!created) return null;
      assertConnection();
      cacheSession(created);
      try {
        if (agent) {
          await palot.switchAgent({ sessionID: created.id, agent });
          created = { ...created, agent };
          cacheSession(created);
          assertConnection();
        }
        if (model) {
          await palot.switchModel({ sessionID: created.id, model });
          created = { ...created, model };
          cacheSession(created);
          assertConnection();
        }
      } catch (error) {
        setCreationErrorState({
          identity: workspaceIdentity,
          message:
            error instanceof Error ? error.message : "Could not apply this task's selection.",
        });
        // Keep the draft intact. Returning a session here would submit with the wrong selection.
        throw error;
      }
      onSessionCreated?.(created.id);
      return created;
    },
    [
      draftSession,
      store,
      runtime?.connectionID,
      runtime?.profileID,
      selectedProject,
      onSessionCreated,
      cacheSession,
      selectedSourceBranch,
      workspaceSelection,
      workspaceIdentity,
    ],
  );

  if (!selectedProject || !draftSession) {
    return (
      <main className="flex size-full items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <PalotBeacon className="mx-auto mb-6" />
          <h1 className="text-lg font-semibold">Add a project to start</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a project folder from the sidebar, then start a task in that project.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      className="palot-main-surface @container/new-task relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      aria-label="New task"
      data-palot-new-task
    >
      <div className="palot-main-surface-header window-drag h-(--shell-header-height) shrink-0 border-b bg-background/90" />
      <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-6 pb-16 @max-[720px]/new-task:px-2 @max-[720px]/new-task:pb-8">
        <div className="flex w-full min-w-0 flex-col items-center gap-9">
          <PalotBeacon />
          <h1 className="flex max-w-full flex-wrap items-center justify-center gap-x-1 text-center text-hero/tight font-normal tracking-[-0.035em] max-[720px]:text-2xl">
            <span>What should we build in</span>
            <ProjectSelect
              projects={taskProjects}
              value={selectedProject.id}
              onValueChange={(value) => value && selectProject(value)}
              ariaLabel={`Project: ${projectName(selectedProject)}`}
              variant="heading"
            />
            <span>?</span>
          </h1>
          <Composer
            key={draftSession.id}
            session={draftSession}
            messages={[]}
            isWorking={false}
            onCreateSession={createSession}
            onCreateSessionError={(error) =>
              setCreationErrorState({
                identity: workspaceIdentity,
                message: error instanceof Error ? error.message : "Could not create this task.",
              })
            }
            contextBarMode="compact"
            contextBar={
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1.5">
                <ConnectionDestination />
                <ProjectSelect
                  projects={taskProjects}
                  value={selectedProject.id}
                  onValueChange={(value) => value && selectProject(value)}
                  ariaLabel="Project"
                  variant="context"
                />
                <WorkspacePicker
                  project={selectedProject}
                  selection={workspaceSelection}
                  onSelect={(selection) => {
                    const mode = selection.type === "current" ? "current" : "worktree";
                    setWorkspaceOverride({
                      identity: `${selectedProject.id}\0${mode}`,
                      selection,
                    });
                    setDefaultWorkspaceMode(mode);
                  }}
                />
                {workspaceSelection.type === "create" && branchOptions.length > 0 ? (
                  <BranchPicker
                    branches={branchOptions}
                    value={selectedSourceBranch ?? branchOptions[0]!}
                    search={branchSearch}
                    onSearchChange={setBranchSearch}
                    onSelect={(branch) => {
                      setWorkspaceOverride({
                        identity: `${selectedProject.id}\0worktree`,
                        selection: { type: "create", branch },
                      });
                      setCreationErrorState(null);
                    }}
                  />
                ) : null}
                {workspaceSelection.type !== "create" || branchOptions.length === 0 ? (
                  <div
                    className="ml-auto flex h-6 min-w-0 items-center gap-1 px-1.5 text-meta leading-none text-muted-foreground max-[560px]:ml-0"
                    title={
                      workspaceSelection.type === "create"
                        ? "OpenCode creates a detached worktree at the current checkout's HEAD commit"
                        : "Current branch for the selected checkout"
                    }
                  >
                    <GitBranch className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {workspaceSelection.type === "create" ? "From" : "On"}{" "}
                      {selectedSourceBranch ?? "current HEAD"}
                    </span>
                  </div>
                ) : null}
                {creationError ? (
                  <span
                    className="basis-full truncate px-2 pt-0.5 text-xs text-destructive"
                    role="alert"
                  >
                    {creationError}
                  </span>
                ) : null}
              </div>
            }
          />
        </div>
      </section>
    </main>
  );
}
