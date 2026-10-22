/** Composer context: resolved mention chips and the recent project outputs picker. */

import type { LocationRef } from "@opencode/client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { ArrowUpRight, Bot, FileClock, FileText, FolderSymlink, Sparkles, X } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { PalotSession } from "../../shared";
import { transcriptJumpTargetAtom } from "../atoms/workbench";
import type { ComposerMention } from "../lib/composer-draft";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import {
  collectRecentProjectOutputs,
  type LoadedTask,
  type RecentProjectOutput,
} from "../lib/recent-project-outputs";
import { formatRelativeTime } from "../lib/view-models";
import { mapSession } from "../services/opencode-mappers";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "./ui/attachment";
import {
  ComposerPicker,
  type ComposerPickerOption,
  type ComposerPickerSection,
} from "./ui/composer-picker";

const MENTION_KIND_LABELS: Record<ComposerMention["kind"], string> = {
  file: "File",
  agent: "Agent",
  skill: "Skill",
  reference: "Reference",
};

function MentionIcon({ kind }: { kind: ComposerMention["kind"] }) {
  if (kind === "agent") return <Bot aria-hidden="true" />;
  if (kind === "skill") return <Sparkles aria-hidden="true" />;
  if (kind === "reference") return <FolderSymlink aria-hidden="true" />;
  return <FileText aria-hidden="true" />;
}

/** One resolved mention from the draft, shown beside attachments and removable on its own. */
export const ComposerMentionChip = memo(function ComposerMentionChip({
  mention,
  onRemove,
}: {
  mention: ComposerMention;
  onRemove(localID: string): void;
}) {
  const kind = MENTION_KIND_LABELS[mention.kind];
  return (
    <Attachment
      size="xs"
      className="max-w-60 min-w-0 bg-background/55"
      data-palot-composer-mention={mention.kind}
      title={mention.kind === "reference" && mention.path ? mention.path : mention.text}
    >
      <AttachmentMedia>
        <MentionIcon kind={mention.kind} />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{mention.text}</AttachmentTitle>
        <AttachmentDescription>{kind}</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction
          aria-label={`Remove ${kind.toLowerCase()} mention ${mention.text}`}
          onClick={() => onRemove(mention.localID)}
        >
          <X aria-hidden="true" />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
});

type OutputChoice =
  | { type: "attach"; output: RecentProjectOutput }
  | { type: "open"; sessionID: string; userMessageID: string | null };

/**
 * Lists files changed or produced by loaded tasks of this project. Choosing one inserts a
 * workspace `@file` mention, which OpenCode resolves and checks when the prompt is sent.
 */
export const RecentOutputsPicker = memo(function RecentOutputsPicker({
  connectionID,
  profileID,
  projectID,
  location,
  projectOf,
  disabled,
  onAttach,
  onSelectionComplete,
}: {
  connectionID: string | null;
  profileID: string | null;
  projectID: string;
  location: LocationRef;
  projectOf(session: PalotSession): string;
  disabled?: boolean;
  onAttach(path: string): void;
  onSelectionComplete?(): void;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  // Tests and detached surfaces may render the composer without a router.
  const router = useRouter({ warn: false });
  const setJumpTarget = useSetAtom(transcriptJumpTargetAtom);

  const groups = useMemo(() => {
    if (!open || !connectionID) return [];
    const reconciler = openCodeReconciler(queryClient);
    const tasks: LoadedTask[] = reconciler.sessions(connectionID).map((info) => {
      const session = mapSession(info);
      return { connectionID, session, messages: reconciler.messages(connectionID, session.id) };
    });
    return collectRecentProjectOutputs({ connectionID, projectID, location, tasks, projectOf });
  }, [connectionID, location, open, projectID, projectOf, queryClient]);

  const sections = useMemo<ComposerPickerSection<OutputChoice>[]>(() => {
    const now = Date.now();
    return groups.map((group) => ({
      key: group.sessionID,
      heading: group.title,
      options: [
        ...group.outputs.map<ComposerPickerOption<OutputChoice>>((output) => ({
          key: output.key,
          value: { type: "attach", output },
          label: output.name,
          description: output.path ?? output.absolutePath,
          keywords: [output.absolutePath, group.title],
          icon: <FileText className="size-3.5" aria-hidden="true" />,
          badges: [{ label: output.kind === "produced" ? "Output" : "Changed" }],
          meta: formatRelativeTime(output.at, now),
          disabled: output.path === null,
          disabledReason: "Outside this task's folder, so it can't be mentioned here.",
          attributes: { "data-palot-recent-output": output.path ?? "" },
        })),
        {
          key: `open:${group.sessionID}`,
          value: {
            type: "open",
            sessionID: group.sessionID,
            userMessageID: group.outputs[0]?.userMessageID ?? null,
          },
          label: "Open original task",
          description: group.title,
          keywords: [group.title, ...group.outputs.map((output) => output.absolutePath)],
          icon: <ArrowUpRight className="size-3.5" aria-hidden="true" />,
          disabled: !router,
          disabledReason: "Task navigation is unavailable here.",
        },
      ],
    }));
  }, [groups, router]);

  function choose(option: ComposerPickerOption<OutputChoice>) {
    const choice = option.value;
    if (choice.type === "attach") {
      if (choice.output.path) onAttach(choice.output.path);
      return;
    }
    if (!router) return;
    void router
      .navigate({
        to: "/sessions/$sessionID",
        params: { sessionID: choice.sessionID },
        search: { profileID: profileID ?? undefined },
      })
      .then(() => {
        if (choice.userMessageID) {
          setJumpTarget({ sessionID: choice.sessionID, messageID: choice.userMessageID });
        }
      });
  }

  return (
    <ComposerPicker<OutputChoice>
      label={null}
      ariaLabel="Recent project outputs"
      icon={<FileClock className="shrink-0" aria-hidden="true" />}
      triggerClassName="gap-0.5 px-1.5"
      tooltip="Mention a recent output from this project"
      disabled={disabled || !connectionID}
      open={open}
      onOpenChange={setOpen}
      popupClassName="w-[min(420px,calc(100vw-24px))]"
      title="Recent outputs"
      description="Files changed or created by tasks loaded in this window. Mentions are rechecked when sent."
      listLabel="Recent project outputs"
      search={{ label: "Search recent outputs", placeholder: "Search outputs…" }}
      sections={sections}
      emptyLabel="No recent outputs in loaded tasks of this project."
      errorTitle="Could not use this output"
      onSelect={choose}
      onSelectionComplete={onSelectionComplete}
    />
  );
});
