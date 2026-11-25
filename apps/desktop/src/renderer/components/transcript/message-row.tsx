import { CalendarClock, Check, Copy, FileText, Sparkles } from "lucide-react";
import { useAtomValue } from "jotai";
import { memo, useLayoutEffect, useRef, useState } from "react";
import type { PalotMessage, PalotMessageContent } from "../../../shared";
import { fileUrl } from "../../lib/file-reference";
import { fileUriPath } from "../../lib/composer-restoration";
import { FileLinkMenu } from "../link-actions";
import { cn } from "../../lib/cn";
import { EditFromHereButton } from "./edit-from-here";
import { writeClipboardText } from "../../lib/clipboard";
import { type TurnActivityGroup } from "../../lib/turn-projection";
import { isTool, messageRole, messageText } from "../../lib/view-models";
import { transcriptFindPartKey, transcriptPartText } from "../../lib/transcript-search";
import { CompactionBoundary } from "./compaction-row";
import { ThoughtDisclosure, TimelineBoundary } from "./timeline-parts";
import { FileAttachment } from "../file-attachment";
import {
  MarkdownContent,
  useWorkspaceDirectory,
  useWorkspaceFileOpener,
} from "../markdown-content";
import { AttachmentGroup } from "../ui/attachment";
import { Bubble, BubbleContent } from "../ui/bubble";
import { Button } from "../ui/button";
import { Message, MessageContent, MessageHeader } from "../ui/message";
import { ToolExecution } from "../tool-execution";
import { prContextSegments } from "../../lib/pr-context";
import { PrContextChip } from "./pr-context-chip";
import { quotedUserText } from "../../lib/inline-quotes";
import { UserMessageQuotes } from "./user-message-quotes";
import {
  promptAutomation,
  promptAutomationLabel,
  type PromptAutomation,
} from "../../lib/prompt-automation";
import { automationSnapshotAtom } from "../../atoms/automations";
import { usePalotNavigation } from "../../hooks/use-navigation";

export const MessageRow = memo(function MessageRow({
  message,
  parts: selectedParts,
  label,
  className,
}: {
  message: PalotMessage;
  parts?: PalotMessageContent[];
  /** A short muted note above the bubble, such as "Steer". */
  label?: string;
  className?: string;
}) {
  const role = messageRole(message);
  const parts =
    selectedParts ??
    (message.content.length > 0 ? message.content : [{ type: "text", text: message.text ?? "" }]);
  const align = role === "user" ? "end" : "start";
  const automation = role === "user" ? promptAutomation(message) : null;
  const userContentSummary = role === "user" ? summarizeMessageParts(parts) : null;
  const hasUserText =
    role === "user" &&
    (Boolean(message.fileReferences?.length || message.skillReferences?.length) ||
      parts.some(
        (part) => !("text" in part) || (typeof part.text === "string" && part.text.trim() !== ""),
      ));
  const userContent = (
    <>
      {message.fileReferences?.length || message.skillReferences?.length ? (
        <MessageReferences
          files={message.fileReferences ?? []}
          skills={message.skillReferences ?? []}
        />
      ) : null}
      {parts.map((part, index) => (
        <MessagePartView
          key={part.id ?? `${message.id}-${index}`}
          message={message}
          part={part}
          index={index}
          live={message.completedAt === null}
        />
      ))}
    </>
  );
  return (
    <Message
      role="article"
      aria-label={`${role} message`}
      align={align}
      className={className}
      data-palot-prompt-id={role === "user" ? message.id : undefined}
    >
      <MessageContent>
        {automation ? (
          <AutomationAttribution automation={automation} label={label} />
        ) : label ? (
          <MessageHeader>{label}</MessageHeader>
        ) : null}
        <Bubble
          align={align}
          variant={role === "user" ? "secondary" : "ghost"}
          className={cn(role === "assistant" && "w-full")}
        >
          <BubbleContent className={cn(role === "assistant" && "w-full")}>
            {/* Attachments lead the text, matching the composer. */}
            {message.files?.length ? (
              <MessageAttachments files={message.files} className={cn(hasUserText && "mb-2")} />
            ) : null}
            {userContentSummary ? (
              <ExpandableUserMessageContent
                likelyLong={userContentSummary.likelyLong}
                accessibleText={userContentSummary.text}
              >
                {userContent}
              </ExpandableUserMessageContent>
            ) : (
              userContent
            )}
          </BubbleContent>
        </Bubble>
        {role === "user" ? (
          <div className="flex items-center gap-0.5 self-end">
            {userContentSummary?.text.trim() ? (
              <CopyPromptButton text={userContentSummary.text} />
            ) : null}
            {/* An automation's prompt is not yours to edit and resend. */}
            {automation ? null : <EditFromHereButton message={message} />}
          </div>
        ) : null}
      </MessageContent>
    </Message>
  );
});

/** Says an automation sent this prompt, in place of the reader's own attribution. */
function AutomationAttribution({
  automation,
  label,
}: {
  automation: PromptAutomation;
  /** A turn label such as "Steer", kept in front. */
  label?: string;
}) {
  const { openScheduled } = usePalotNavigation();
  const snapshot = useAtomValue(automationSnapshotAtom);
  const name =
    automation.source === "palot"
      ? (snapshot?.automations.find((entry) => entry.id === automation.automationID)?.name ?? null)
      : null;
  const text = promptAutomationLabel(automation, name);
  return (
    <MessageHeader className="gap-1" data-palot-automation-prompt={automation.source}>
      {label ? <span>{label} ·</span> : null}
      <button
        type="button"
        className="inline-flex min-w-0 items-center gap-1 rounded-sm hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        title="Sent by an automation. Open Scheduled"
        onClick={() =>
          void openScheduled(
            automation.source === "palot"
              ? {
                  automationID: automation.automationID,
                  ...(automation.runID ? { runID: automation.runID } : {}),
                }
              : {},
          )
        }
      >
        <CalendarClock aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">{text}</span>
      </button>
    </MessageHeader>
  );
}

/** Copies the whole prompt, also while a long message is collapsed. */
function CopyPromptButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="xs"
      variant="ghost"
      className="opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100"
      onClick={() => {
        void writeClipboardText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? "Copied" : "Copy prompt"}
    </Button>
  );
}

const COLLAPSED_USER_MESSAGE_HEIGHT = 208;

function summarizeMessageParts(parts: PalotMessageContent[]): {
  likelyLong: boolean;
  text: string;
} {
  const textParts: string[] = [];
  let lines = 0;
  for (const part of parts) {
    if (!("text" in part) || typeof part.text !== "string") continue;
    textParts.push(part.text);
    lines += part.text.split("\n").length - 1;
  }
  const text = textParts.join("\n");
  return { likelyLong: text.length > 700 || lines > 12, text };
}

function ExpandableUserMessageContent({
  children,
  likelyLong,
  accessibleText,
}: {
  children: React.ReactNode;
  likelyLong: boolean;
  accessibleText: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [measured, setMeasured] = useState(false);
  const [measuredOverflow, setMeasuredOverflow] = useState(false);
  const overflowing = measured ? measuredOverflow : likelyLong;
  const collapsed = overflowing && !expanded;

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      if (content.scrollHeight <= 0) return;
      setMeasured(true);
      setMeasuredOverflow(content.scrollHeight > COLLAPSED_USER_MESSAGE_HEIGHT + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div>
      <div
        className={cn("relative", collapsed && "overflow-hidden")}
        style={collapsed ? { maxHeight: COLLAPSED_USER_MESSAGE_HEIGHT } : undefined}
      >
        {collapsed && accessibleText ? <span className="sr-only">{accessibleText}</span> : null}
        <div
          ref={contentRef}
          inert={collapsed ? true : undefined}
          aria-hidden={collapsed || undefined}
        >
          {children}
        </div>
        {collapsed ? (
          <span
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-secondary to-transparent"
            aria-hidden="true"
          />
        ) : null}
      </div>
      {overflowing ? (
        <button
          type="button"
          className="mt-1.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Keys by URI plus its occurrence, not list position. The server echo lists inline-delivered files
 * before path-delivered ones, so positional keys would remount (and flash) optimistic previews.
 */
function attachmentKeys(files: NonNullable<PalotMessage["files"]>) {
  const seen = new Map<string, number>();
  return files.map((file) => {
    const occurrence = seen.get(file.uri) ?? 0;
    seen.set(file.uri, occurrence + 1);
    return { key: `${file.uri}#${occurrence}`, file };
  });
}

function MessageAttachments({
  files,
  className,
}: {
  files: NonNullable<PalotMessage["files"]>;
  className?: string;
}) {
  return (
    <AttachmentGroup
      className={cn("max-w-full justify-start py-0", className)}
      aria-label="Attachments"
    >
      {attachmentKeys(files).map(({ key, file }) => (
        <FileAttachment key={key} file={file} />
      ))}
    </AttachmentGroup>
  );
}

function MessageReferences({
  files,
  skills,
}: {
  files: NonNullable<PalotMessage["fileReferences"]>;
  skills: NonNullable<PalotMessage["skillReferences"]>;
}) {
  return (
    <div className="mb-2 flex max-w-full flex-wrap justify-end gap-1.5" aria-label="References">
      {files.map((file, index) => (
        <MessageFileReference key={`${file.uri}:${file.mention.start}:${index}`} file={file} />
      ))}
      {skills.map((skill, index) => (
        <span
          key={`${skill.id}:${skill.mention.start}:${index}`}
          className="flex max-w-64 items-center gap-1.5 rounded-md border border-foreground/10 bg-background/45 px-2 py-1 text-xs"
        >
          <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">${skill.id}</span>
        </span>
      ))}
    </div>
  );
}

const MESSAGE_REFERENCE_CLASS =
  "flex max-w-64 items-center gap-1.5 rounded-md border border-foreground/10 bg-background/45 px-2 py-1 text-xs";

/** A mentioned file opens like a transcript file link; other references only offer their path. */
function MessageFileReference({
  file,
}: {
  file: NonNullable<PalotMessage["fileReferences"]>[number];
}) {
  const opener = useWorkspaceFileOpener();
  const directory = useWorkspaceDirectory();
  const path = fileUriPath(file.uri);
  const content = (
    <>
      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">@{file.name}</span>
    </>
  );
  if (!path) {
    return (
      <span className={MESSAGE_REFERENCE_CLASS} title={file.uri}>
        {content}
      </span>
    );
  }
  // A workspace file's URI ends with the path it mentions; a reference names a folder elsewhere.
  const mentioned = file.mention.text.replace(/^@/, "");
  const workspaceFile = path.replaceAll("\\", "/").endsWith(`/${mentioned}`);
  if (!opener || !workspaceFile) {
    return (
      <FileLinkMenu reference={{ path }} directory={directory}>
        <span className={MESSAGE_REFERENCE_CLASS} title={path}>
          {content}
        </span>
      </FileLinkMenu>
    );
  }
  const open = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.preventDefault();
    opener({ path }, event);
  };
  return (
    <FileLinkMenu reference={{ path }} directory={directory} onOpen={opener}>
      <a
        href={fileUrl(path)}
        title={path}
        aria-label={`Open ${path}`}
        onClick={open}
        className={cn(
          MESSAGE_REFERENCE_CLASS,
          "cursor-pointer text-foreground outline-none hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring aria-busy:cursor-progress aria-busy:opacity-70",
        )}
      >
        {content}
      </a>
    </FileLinkMenu>
  );
}

export function MessagePartView({
  message,
  part,
  index,
  live = false,
  defaultOpen = false,
}: {
  message: PalotMessage;
  part: PalotMessageContent;
  index: number;
  live?: boolean;
  defaultOpen?: boolean;
}) {
  if (isTool(part)) return <ToolExecution part={part} index={index} defaultOpen={defaultOpen} />;
  if (part.type === "compaction") {
    const group: TurnActivityGroup = {
      id: part.id ?? `${message.id}:compaction:${index}`,
      kind: "compaction",
      title: "Compacting context",
      status:
        part.status === "failed" ? "failed" : part.status === "running" ? "running" : "completed",
      entries: [{ message, part, index }],
    };
    return <CompactionBoundary group={group} />;
  }
  if (part.type === "timeline-boundary") {
    return (
      <TimelineBoundary
        group={{
          id: part.id ?? `${message.id}:boundary:${index}`,
          kind: "boundary",
          title: part.name ?? "Session update",
          status:
            part.status === "failed"
              ? "failed"
              : part.status === "running"
                ? "running"
                : part.status === "interrupted"
                  ? "interrupted"
                  : "completed",
          entries: [{ message, part, index }],
        }}
      />
    );
  }
  if (part.type === "reasoning") {
    const reasoning = messageText(message, part).trim();
    return reasoning ? <ThoughtDisclosure entry={{ message, part, index }} live={live} /> : null;
  }
  const raw = transcriptPartText(message, part);
  if (!raw) return null;
  const user = messageRole(message) === "user";
  // Review and browser comments show as quote chips, not the sentences the agent received.
  const quoted = user ? quotedUserText(message, raw) : null;
  const value = quoted ? quoted.text.trim() : raw;
  const quotes = quoted ? (
    <UserMessageQuotes quotes={quoted.quotes} className={cn(value && "mt-2")} />
  ) : null;
  if (!value) {
    return (
      <div data-transcript-find-part={transcriptFindPartKey(message, part)} className="contents">
        {quotes}
      </div>
    );
  }
  const segments = user ? prContextSegments(value) : null;
  if (segments && segments.some((segment) => segment.kind === "context")) {
    return (
      <div data-transcript-find-part={transcriptFindPartKey(message, part)} className="contents">
        {segments.map((segment, at) =>
          segment.kind === "context" ? (
            <div key={at} className="flex justify-end">
              <PrContextChip label={segment.label} source={segment.source} />
            </div>
          ) : segment.text.trim() ? (
            <MarkdownContent key={at} value={segment.text.trim()} literalSingleTilde />
          ) : null,
        )}
        {quotes}
      </div>
    );
  }
  return (
    // Find in task maps data matches to rendered text through this key.
    <div data-transcript-find-part={transcriptFindPartKey(message, part)} className="contents">
      <MarkdownContent
        value={value}
        streaming={live && message.type === "assistant"}
        literalSingleTilde={user}
      />
      {quotes}
    </div>
  );
}
