import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  ChevronDown,
  FolderGit2,
  LoaderCircle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PalotProject, PalotSession } from "../../../shared";
import { runtimeAtom } from "../../atoms/workspace";
import { useProjectWorktrees, useRemoveProjectCopy } from "../../hooks/use-project-worktrees";
import { useProjectCatalogState, useSessionCatalog } from "../../hooks/use-session-catalog";
import { useSessionActivityForSession } from "../../hooks/use-session-activity";
import { validateProjectSearch } from "../../lib/route-search";
import { showErrorToast } from "../../lib/toast-error";
import { orderProjects, visibleProjects } from "../../lib/view-models";
import { worktreeRemovalRequiresForce } from "../../services/opencode-worktrees";
import { getOpenCodeVcsStatus } from "../../services/opencode-vcs";
import { ProjectSelect } from "../project-select";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { toast } from "../ui/toast";

interface RemovalTarget {
  connectionID: string;
  projectID: string;
  directory: string;
  files: string[];
  forceRequired: boolean;
}

export function WorktreesPage() {
  const search = useRouterState({
    select: (state) => validateProjectSearch(state.location.search as Record<string, unknown>),
  });
  const navigate = useNavigate();
  const runtime = useAtomValue(runtimeAtom);
  const catalog = useProjectCatalogState();
  const sessions = useSessionCatalog();
  const projects = useMemo(
    () => visibleProjects(orderProjects(catalog.projects, sessions)),
    [catalog.projects, sessions],
  );
  const project = projects.find((candidate) => candidate.id === search.projectID) ?? null;
  const worktreesQuery = useProjectWorktrees(project);
  const removeProjectCopy = useRemoveProjectCopy(project);
  const [target, setTarget] = useState<RemovalTarget | null>(null);
  const [checkingDirectory, setCheckingDirectory] = useState<string | null>(null);
  const removalGeneration = useRef(0);
  useEffect(() => {
    removalGeneration.current += 1;
    setTarget(null);
    setCheckingDirectory(null);
    return () => {
      removalGeneration.current += 1;
    };
  }, [runtime?.connectionID, project?.id]);
  const managed = useMemo(
    () =>
      (worktreesQuery.data ?? []).filter(
        (item) => item.strategy !== null && item.directory !== project?.canonical,
      ),
    [project?.canonical, worktreesQuery.data],
  );

  const updateProject = (projectID: string | null) => {
    if (!projectID) return;
    void navigate({ to: "/worktrees", search: { projectID }, replace: true });
  };

  const remove = useCallback(async () => {
    if (!target || !project) return;
    const generation = removalGeneration.current;
    try {
      if (target.connectionID !== runtime?.connectionID || target.projectID !== project.id)
        throw new Error(
          "The server or project changed. Check this worktree again before removing it.",
        );
      await removeProjectCopy.mutateAsync({
        directory: target.directory,
        force: target.forceRequired,
      });
      if (generation !== removalGeneration.current) return;
      setTarget(null);
      toast.add({
        type: "success",
        title: "Worktree removed",
        description: directoryLabel(target.directory),
      });
    } catch (error) {
      if (generation !== removalGeneration.current) return;
      if (!target.forceRequired && worktreeRemovalRequiresForce(error)) {
        setTarget({ ...target, forceRequired: true });
        return;
      }
      showErrorToast("Could not remove worktree", error);
    }
  }, [project, removeProjectCopy, target, runtime?.connectionID]);

  const prepareRemoval = useCallback(
    async (directory: string) => {
      if (!runtime?.connected || !project) return;
      const generation = ++removalGeneration.current;
      setCheckingDirectory(directory);
      try {
        const files = await getOpenCodeVcsStatus({ directory }, undefined, runtime.connectionID);
        if (generation !== removalGeneration.current) return;
        setTarget({
          connectionID: runtime.connectionID,
          projectID: project.id,
          directory,
          files: files.map((file) => file.file),
          forceRequired: files.length > 0,
        });
      } catch (error) {
        if (generation === removalGeneration.current)
          showErrorToast("Could not check worktree changes", error);
      } finally {
        if (generation === removalGeneration.current) setCheckingDirectory(null);
      }
    },
    [runtime, project],
  );

  return (
    <main
      className="palot-main-surface relative size-full min-h-0 min-w-0 overflow-hidden bg-background"
      aria-label="Worktrees"
    >
      <div className="window-drag h-(--shell-header-height) shrink-0" aria-hidden="true" />
      <div className="palot-native-scrollbar h-[calc(100%-var(--shell-header-height))] overflow-y-auto px-6 pb-16 @max-[42rem]/workspace-shell:px-3">
        <div className="mx-auto w-full max-w-4xl pt-5">
          <header className="mb-7 flex flex-wrap items-start gap-4 px-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-page-title/tight font-medium tracking-[-0.035em]">Worktrees</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage isolated OpenCode checkouts for one project.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ProjectSelect
                projects={projects}
                value={project?.id ?? null}
                onValueChange={updateProject}
                ariaLabel="Select worktree project"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh worktrees"
                disabled={!project || runtime?.connected !== true || worktreesQuery.isFetching}
                onClick={() => void worktreesQuery.refetch()}
              >
                <RefreshCw className={worktreesQuery.isFetching ? "animate-spin" : undefined} />
              </Button>
            </div>
          </header>

          {!project && catalog.ready ? <ProjectRequired projects={projects} /> : null}
          {project && runtime?.connected === false ? (
            <Alert>
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>OpenCode is disconnected</AlertTitle>
              <AlertDescription>Reconnect to inspect or remove managed worktrees.</AlertDescription>
            </Alert>
          ) : null}
          {project && worktreesQuery.error ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Could not load worktrees</AlertTitle>
              <AlertDescription>{worktreesQuery.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {project && !worktreesQuery.data && worktreesQuery.isPending ? (
            <div className="flex items-center gap-2 px-3 py-8 text-sm text-muted-foreground">
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Loading worktrees
            </div>
          ) : null}
          {project && worktreesQuery.data ? (
            <section
              className="overflow-hidden rounded-xl border bg-card/45"
              aria-label="Project worktrees"
            >
              <WorktreeRow
                directory={project.canonical}
                label="Main checkout"
                detail="Primary project directory"
              />
              {managed.map((item) => {
                const attached = sessions.filter(
                  (session) =>
                    session.projectID === project.id &&
                    session.location.directory === item.directory,
                );
                return (
                  <WorktreeRow
                    key={item.directory}
                    directory={item.directory}
                    attachedTasks={attached}
                    checking={checkingDirectory === item.directory}
                    removing={removeProjectCopy.isPending && target?.directory === item.directory}
                    onRemove={() => void prepareRemoval(item.directory)}
                  />
                );
              })}
              {managed.length === 0 ? (
                <Empty className="min-h-40 border-0 border-t rounded-none">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FolderGit2 aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>No managed worktrees</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
      <RemovalDialog
        target={target}
        pending={removeProjectCopy.isPending}
        onClose={() => setTarget(null)}
        onRemove={remove}
      />
    </main>
  );
}

function ProjectRequired({ projects }: { projects: PalotProject[] }) {
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderGit2 aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{projects.length ? "Select a project" : "No projects available"}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function WorktreeRow({
  directory,
  label = directoryLabel(directory),
  detail,
  attachedTasks = [],
  checking = false,
  removing = false,
  onRemove,
}: {
  directory: string;
  label?: string;
  detail?: string;
  attachedTasks?: PalotSession[];
  checking?: boolean;
  removing?: boolean;
  onRemove?: () => void;
}) {
  const removalBlocked = attachedTasks.length > 0 || checking || removing;
  return (
    <Collapsible className="min-w-0 border-b last:border-b-0">
      <div className="flex min-h-20 items-center gap-3 px-4 py-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background/70 text-muted-foreground">
          <FolderGit2 className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-all font-medium">{label}</span>
            {!onRemove ? <Badge variant="secondary">Primary</Badge> : null}
            {onRemove && attachedTasks.length > 0 ? (
              <CollapsibleTrigger
                render={<Button variant="ghost" size="sm" />}
                aria-label={`Tasks in ${label}`}
              >
                {attachedTasks.length} {attachedTasks.length === 1 ? "task" : "tasks"}
                <ChevronDown
                  className="transition-transform in-data-open:rotate-180"
                  aria-hidden="true"
                />
              </CollapsibleTrigger>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={directory}>
            {detail ?? directory}
          </p>
        </div>
        {onRemove ? (
          <div className="flex shrink-0 items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${label}`}
              title={
                attachedTasks.length > 0
                  ? "Move these tasks before removing the worktree"
                  : undefined
              }
              disabled={removalBlocked}
              onClick={onRemove}
            >
              {checking || removing ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
            </Button>
          </div>
        ) : null}
      </div>
      {attachedTasks.length > 0 ? (
        <CollapsibleContent>
          <ul className="min-w-0 space-y-1 px-4 pb-3" aria-label={`Tasks in ${label}`}>
            {attachedTasks.map((session) => (
              <AttachedTaskLink key={session.id} session={session} />
            ))}
          </ul>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function AttachedTaskLink({ session }: { session: PalotSession }) {
  const activity = useSessionActivityForSession(session.id).data;
  const status = activity.execution.get(session.id)?.status;
  const statusLabel = status
    ? {
        inactive: "Idle",
        running: "Running",
        succeeded: "Finished",
        failed: "Failed",
        interrupted: "Interrupted",
      }[status]
    : null;
  const title = session.title?.trim() || "Untitled task";
  return (
    <li className="min-w-0">
      <Link
        to="/sessions/$sessionID"
        params={{ sessionID: session.id }}
        search={{}}
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        title={title}
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {statusLabel ? <Badge variant="secondary">{statusLabel}</Badge> : null}
        {session.archivedAt !== null ? <Badge variant="outline">Archived</Badge> : null}
      </Link>
    </li>
  );
}

function RemovalDialog({
  target,
  pending,
  onClose,
  onRemove,
}: {
  target: RemovalTarget | null;
  pending: boolean;
  onClose: () => void;
  onRemove: () => void | Promise<void>;
}) {
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2 aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>
            Remove {target ? directoryLabel(target.directory) : "worktree"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target?.forceRequired
              ? target.files.length
                ? `This permanently discards ${target.files.length} changed ${target.files.length === 1 ? "file" : "files"} and removes the managed worktree.`
                : "The worktree changed after it was checked. Removing it now permanently discards its uncommitted changes."
              : "This removes the managed worktree. The main checkout is not affected."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {target?.files.length ? (
          <div className="max-h-36 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-code-compact text-muted-foreground">
            {target.files.slice(0, 20).map((file) => (
              <div key={file} className="truncate" title={file}>
                {file}
              </div>
            ))}
            {target.files.length > 20 ? <div>+{target.files.length - 20} more</div> : null}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() => void onRemove()}
          >
            {pending ? "Removing..." : "Remove worktree"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function directoryLabel(directory: string): string {
  return directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory;
}
