import { useState } from "react";
import { useAtomValue } from "jotai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderGit2 } from "lucide-react";
import type { PalotProject } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { mapProject } from "../services/opencode-mappers";
import {
  loadProjectDetails,
  updateProjectDetails,
  type ProjectEdits,
} from "../services/opencode-projects";
import { SettingsGroup, SettingsSection } from "./settings-layout";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Alert, AlertDescription } from "./ui/alert";

export const projectDetailsKey = (connectionID: string, projectID: string) =>
  [...openCodeKeys.projects(connectionID), "details", projectID] as const;

export function ProjectSettings({ project }: { project: PalotProject }) {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  return (
    <ProjectSettingsScope
      key={`${connectionID}:${project.id}`}
      projectID={project.id}
      connectionID={connectionID}
    />
  );
}

function ProjectSettingsScope({
  projectID,
  connectionID,
}: {
  projectID: string;
  connectionID: string;
}) {
  const client = useQueryClient();
  const key = projectDetailsKey(connectionID, projectID);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => loadProjectDetails(projectID, signal),
  });
  const [edits, setEdits] = useState<ProjectEdits>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const project = query.data;

  async function save() {
    if (!project || pending) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateProjectDetails(projectID, edits);
      client.setQueryData(key, updated);
      client.setQueryData<PalotProject[]>(openCodeKeys.projects(connectionID), (items) =>
        items?.map((item) => (item.id === updated.id ? mapProject(updated) : item)),
      );
      setEdits({});
      setSaved(true);
      // Refresh both locations without moving sessions or touching either checkout.
      const directories = new Set([
        project.canonical,
        updated.canonical,
        ...project.sandboxes,
        ...updated.sandboxes,
      ]);
      void client.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === "opencode" &&
          queryKey[1] === connectionID &&
          (queryKey[2] === "projects" ||
            (queryKey[2] === "worktrees" && queryKey[3] === projectID) ||
            directories.has(String(queryKey[3]))),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save project settings.");
    } finally {
      setPending(false);
    }
  }

  if (!project)
    return (
      <SettingsSection title="Project" icon={FolderGit2}>
        {query.error ? (
          <Alert variant="destructive">
            <AlertDescription>
              {query.error.message}
              <Button variant="ghost" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <p role="status">Loading project settings…</p>
        )}
      </SettingsSection>
    );

  function field(name: keyof ProjectEdits, label: string, value: string, description: string) {
    return (
      <Field>
        <FieldLabel htmlFor={`project-${name}`}>{label}</FieldLabel>
        <Input
          id={`project-${name}`}
          value={edits[name] ?? value}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value;
            setEdits((current) => {
              const result = { ...current, [name]: next };
              if (next === value) delete result[name];
              return result;
            });
            setSaved(false);
          }}
        />
        <FieldDescription>{description}</FieldDescription>
      </Field>
    );
  }

  return (
    <SettingsSection
      title="Project details"
      icon={FolderGit2}
      description="Saved by OpenCode for this project, not written to your configuration files."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="space-y-4"
      >
        <SettingsGroup>
          <FieldGroup className="p-4">
            {field(
              "name",
              "Project name",
              project.name ?? "",
              "Leave blank to use the directory name.",
            )}
            {field(
              "override",
              "Icon override",
              project.icon?.override ?? "",
              "Image URL or data URL. Leave blank to use the discovered project icon.",
            )}
            {field(
              "color",
              "Icon color",
              project.icon?.color ?? "",
              "Optional color value. Leave blank to clear the override.",
            )}
            {field(
              "start",
              "Worktree startup command",
              project.commands?.start ?? "",
              "Runs when OpenCode creates a worktree. Saving does not run it. Leave blank to disable.",
            )}
            {field(
              "canonical",
              "Main checkout directory",
              project.canonical,
              "Absolute path on the connected OpenCode server. Changes the project's canonical directory metadata only; files and existing sessions are not moved.",
            )}
          </FieldGroup>
        </SettingsGroup>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || Object.keys(edits).length === 0}>
            {pending ? "Saving…" : "Save project"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending || Object.keys(edits).length === 0}
            onClick={() => {
              setEdits({});
              setError(null);
              setSaved(false);
            }}
          >
            Discard changes
          </Button>
          {saved ? (
            <p role="status" className="text-compact text-muted-foreground">
              Project settings saved.
            </p>
          ) : null}
        </div>
      </form>
    </SettingsSection>
  );
}
