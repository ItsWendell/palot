import { useAtomValue } from "jotai";
import { Bot, ChevronRight, Copy, LoaderCircle, SquareMousePointer } from "lucide-react";
import { useMemo, useState, type ComponentType } from "react";
import { newTaskApprovalModeAtom } from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import {
  useCacheSession,
  useProjectCatalog,
  useSessionCatalog,
} from "../hooks/use-session-catalog";
import { usePalotNavigation } from "../hooks/use-navigation";
import { withoutChatProjects } from "../lib/chats";
import { writeClipboardText } from "../lib/clipboard";
import { approvalPresetRules } from "../lib/session-permissions";
import {
  SWITCHING_SOURCES,
  buildSwitchingPrompt,
  switchingTaskTitle,
  type SwitchingSource,
} from "../lib/switching-prompt";
import { showErrorToast } from "../lib/toast-error";
import { orderProjects, projectLocation, projectName } from "../lib/view-models";
import { createChatSession } from "../services/opencode-chats";
import { palot } from "../services/palot";
import { SettingsGroup, SettingsRow, SettingsSection } from "./settings-layout";
import { Button } from "./ui/button";
import { ChoiceGroup } from "./ui/choice-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldLabel } from "./ui/field";
import { ProviderIcon } from "./ui/provider-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "./ui/toast";

/** The task runs without a project, in a chat folder under the server's home. */
const NO_PROJECT = "none";

function textMark(text: string): ComponentType<{ className?: string }> {
  return function TextMark({ className }) {
    return (
      <span
        aria-hidden="true"
        className={`${className ?? ""} grid place-items-center font-mono text-xs font-bold leading-none`}
      >
        {text}
      </span>
    );
  };
}

function providerMark(id: string): ComponentType<{ className?: string }> {
  return function ProviderMark({ className }) {
    return <ProviderIcon id={id} className={className} />;
  };
}

const SOURCE_ICONS: Record<SwitchingSource, ComponentType<{ className?: string }>> = {
  "claude-code": providerMark("claude-agent"),
  codex: providerMark("openai"),
  "t3-code": textMark("T3"),
  pi: textMark("π"),
  cursor: SquareMousePointer,
  "opencode-app": providerMark("opencode"),
  other: Bot,
};

const SOURCE_OPTIONS = SWITCHING_SOURCES.map((source) => ({
  value: source.id,
  label: source.name,
  icon: SOURCE_ICONS[source.id],
}));

/**
 * State and actions for "Switching from another agent?": pick an agent and a folder, then start
 * a task with the switching prompt or copy the prompt to run elsewhere.
 */
export function useSwitchingFlow({ onStarted }: { onStarted?(): void } = {}) {
  const runtime = useAtomValue(runtimeAtom);
  const approvalMode = useAtomValue(newTaskApprovalModeAtom);
  const projects = useProjectCatalog();
  const sessions = useSessionCatalog();
  const cacheSession = useCacheSession();
  const { openSession } = usePalotNavigation();
  const folders = useMemo(
    () => withoutChatProjects(orderProjects(projects, sessions)),
    [projects, sessions],
  );
  const [source, setSource] = useState<SwitchingSource | null>(null);
  const [projectID, setProjectID] = useState<string>(NO_PROJECT);
  const [starting, setStarting] = useState(false);
  const project = folders.find((candidate) => candidate.id === projectID) ?? null;
  const prompt = source
    ? buildSwitchingPrompt({
        source,
        ...(project ? { directory: projectLocation(project) } : {}),
      })
    : null;

  async function start() {
    if (!source || !prompt || starting) return;
    const connectionID = runtime?.connectionID;
    const permissions = approvalPresetRules(approvalMode);
    setStarting(true);
    try {
      let session = project
        ? await palot.createSession(projectLocation(project), undefined, connectionID, permissions)
        : await createChatSession({
            connectionID,
            permissions,
            prompt: switchingTaskTitle(source),
          });
      if (!session) throw new Error("The server did not create a task.");
      const title = switchingTaskTitle(source);
      await palot.renameSession(session.id, title);
      session = { ...session, title };
      cacheSession(session);
      await palot.sendComposerPrompt({ sessionID: session.id, text: prompt, delivery: "steer" });
      onStarted?.();
      await openSession(session.id);
    } catch (error) {
      showErrorToast("Could not start the switching task", error);
    } finally {
      setStarting(false);
    }
  }

  async function copy() {
    if (!prompt) return;
    try {
      await writeClipboardText(prompt);
      toast.add({ type: "success", title: "Prompt copied" });
    } catch (error) {
      showErrorToast("Could not copy the prompt", error);
    }
  }

  return {
    source,
    setSource,
    projectID,
    setProjectID,
    folders,
    prompt,
    starting,
    connected: runtime?.connected === true,
    start,
    copy,
  };
}

export type SwitchingFlow = ReturnType<typeof useSwitchingFlow>;

/** The agent tiles, the folder choice and the prompt preview. */
export function SwitchingFields({ flow }: { flow: SwitchingFlow }) {
  const project = flow.folders.find((candidate) => candidate.id === flow.projectID);
  return (
    <div className="grid min-w-0 gap-4" data-switching-picker>
      <ChoiceGroup
        variant="card"
        aria-label="Agent you're switching from"
        value={flow.source}
        onValueChange={flow.setSource}
        options={SOURCE_OPTIONS}
      />
      <Field>
        <FieldLabel htmlFor="switching-folder">Run in</FieldLabel>
        <Select
          value={flow.projectID}
          onValueChange={(value) => {
            if (typeof value === "string") flow.setProjectID(value);
          }}
        >
          <SelectTrigger id="switching-folder" className="w-full" aria-label="Run in">
            <SelectValue>{project ? projectName(project) : "No project"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PROJECT}>No project</SelectItem>
            {flow.folders.map((folder) => (
              <SelectItem key={folder.id} value={folder.id}>
                {projectName(folder)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {flow.prompt ? (
        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button type="button" variant="ghost" size="sm" className="group/prompt -ml-2" />
            }
          >
            <ChevronRight
              className="transition-transform group-data-panel-open/prompt:rotate-90 motion-reduce:transition-none"
              aria-hidden="true"
            />
            Show prompt
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre
              className="mt-2 max-h-64 overflow-auto rounded-lg border bg-muted/30 p-3 text-code-compact whitespace-pre-wrap"
              data-switching-prompt
            >
              {flow.prompt}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

export function SwitchingActions({ flow }: { flow: SwitchingFlow }) {
  const ready = flow.source !== null;
  return (
    <>
      <Button type="button" variant="outline" disabled={!ready} onClick={() => void flow.copy()}>
        <Copy aria-hidden="true" />
        Copy prompt
      </Button>
      <Button
        type="button"
        disabled={!ready || !flow.connected || flow.starting}
        onClick={() => void flow.start()}
      >
        {flow.starting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
        Start
      </Button>
    </>
  );
}

export const SWITCHING_DESCRIPTION =
  "Palot starts a task that looks at your old agent's setup, proposes what to bring over, and changes nothing until you say OK.";

/** Mounted only while open, so each opening starts fresh. */
export function SwitchingDialog({ onClose }: { onClose(): void }) {
  const flow = useSwitchingFlow({ onStarted: onClose });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Switching from another agent?</DialogTitle>
          <DialogDescription>{SWITCHING_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <SwitchingFields flow={flow} />
        <DialogFooter>
          <SwitchingActions flow={flow} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The Settings → General entry point. */
export function SwitchingSettings() {
  const [open, setOpen] = useState(false);
  return (
    <SettingsSection title="Getting started">
      <SettingsGroup>
        <SettingsRow
          title="Switching from another agent?"
          description="Palot can bring over your agent setup, projects and scheduled work."
          control={
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
              Bring it over…
            </Button>
          }
        />
      </SettingsGroup>
      {open ? <SwitchingDialog onClose={() => setOpen(false)} /> : null}
    </SettingsSection>
  );
}
