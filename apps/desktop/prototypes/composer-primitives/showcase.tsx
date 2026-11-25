/**
 * A dev-only page that renders the real composer primitives (`components/ui/composer.tsx`) and
 * the dock views with static data, so their states can be looked at side by side.
 * `?theme=light`, `?width=380|520|720` and `?motion=reduced` change the whole page.
 */

import {
  AudioLines,
  CircleAlert,
  CircleGauge,
  Clock3,
  FileText,
  Hammer,
  Hourglass,
  ListChecks,
  MessageSquareCode,
  Mic,
  Pause,
  Pencil,
  Plus,
  ShieldAlert,
  SquareTerminal,
  Target,
  TriangleAlert,
  Undo2,
  WifiOff,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import {
  Composer,
  ComposerActions,
  ComposerContextPie,
  ComposerContextPieGlyph,
  ComposerDock,
  ComposerError,
  ComposerFoldable,
  ComposerFooter,
  ComposerHeader,
  ComposerInputArea,
  ComposerNotice,
  ComposerNoticeAction,
  ComposerNoticeMore,
  ComposerNoticeText,
  ComposerOverflow,
  ComposerOverflowItem,
  ComposerPanel,
  ComposerPill,
  ComposerPillChevron,
  ComposerPillDetail,
  ComposerPillLabel,
  ComposerPrimary,
  ComposerQueue,
  ComposerQueueRow,
  ComposerQueueRowActions,
  ComposerQueueRowStatus,
  ComposerQueueRowText,
  ComposerQueueSummary,
  ComposerStop,
  ComposerTab,
  ComposerTabDetail,
  ComposerTabLabel,
  ComposerTabs,
  type ComposerMode,
  type ComposerPrimaryView,
} from "@/components/ui/composer";
import { PulseDot } from "@/components/ui/pulse-dot";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RequestPanel, EMPTY_ANSWER } from "@/components/composer-dock/request-panel";
import {
  BackgroundWorkPanel,
  GoalPanel,
  PlanPanel,
  UndoStagedPanel,
  VoicePanel,
} from "@/components/composer-dock/tab-panels";
import type {
  FormValues,
  PlanItemView,
  QuestionAnswer,
  RequestView,
} from "@/components/composer-dock/types";

const params = new URLSearchParams(window.location.search);
const WIDTH = Number(params.get("width")) || 720;
const ONLY = params.get("only");

const PLAN: PlanItemView[] = [
  { text: "Reproduce the failing snapshot tests", status: "done" },
  { text: "Find why the queue collapses early", status: "done" },
  { text: "Fix the collapse threshold", status: "done" },
  { text: "Run the e2e suite", active: "Running the e2e suite", status: "running" },
  { text: "Update the affected snapshots", status: "pending" },
  { text: "Run the suite on macOS", status: "pending" },
  { text: "Write the changelog line", status: "pending" },
];

const SHELL: RequestView = {
  kind: "permission",
  id: "shell",
  permission: "shell",
  title: "Run a command",
  subject: "bun run test:e2e -- composer --update-snapshots",
  reason: "Updates 4 snapshot files under test/e2e.",
  rule: "bun run test:e2e *",
};

const EDIT: RequestView = {
  kind: "permission",
  id: "edit",
  permission: "edit",
  title: "Edit a file",
  subject: "src/renderer/components/composer-queue.tsx",
  reason: "Moves the collapse threshold from three messages to four.",
  rule: "edits in src/renderer/components/**",
  diff: [
    { type: "ctx", text: "const COLLAPSE_AFTER = (() => {" },
    { type: "del", text: "  return 3;" },
    { type: "add", text: "  // Four rows still fit above a 720 px composer." },
    { type: "add", text: "  return 4;" },
    { type: "ctx", text: "})();" },
    { type: "ctx", text: "" },
    { type: "ctx", text: "export function shouldCollapse(count: number) {" },
    { type: "ctx", text: "  return count > COLLAPSE_AFTER;" },
    { type: "ctx", text: "}" },
    { type: "ctx", text: "" },
  ],
};

const STEPS: RequestView = {
  kind: "question",
  id: "steps",
  source: "explore",
  steps: [
    {
      prompt: "Two snapshot tests fail because the queue now collapses at three. What should I do?",
      multiple: false,
      custom: true,
      options: [
        { label: "Update the snapshots", description: "The new collapse is intended" },
        { label: "Collapse at four instead", description: "Keep today's snapshots" },
        { label: "Stop and show me the diff", description: "Decide after reading it" },
      ],
    },
    {
      prompt: "Which platforms should the suite run on?",
      multiple: true,
      custom: false,
      options: [{ label: "Linux" }, { label: "macOS" }, { label: "Windows" }],
    },
  ],
};

const FORM: RequestView = {
  kind: "form",
  id: "form",
  server: "linear",
  title: "Create a Linear issue",
  description: "The linear MCP server needs a few details before it files the follow-up.",
  fields: [
    { id: "title", type: "text", label: "Title", placeholder: "Queue collapses too early" },
    { id: "team", type: "select", label: "Team", options: ["Desktop", "Server", "Design"] },
    { id: "assign", type: "checkbox", label: "Assign to me" },
  ],
};

const GUEST: RequestView = {
  kind: "guest",
  id: "guest",
  from: "Maya",
  verified: false,
  text: "Can you also check the queue on Windows before you merge?",
};

type Tab = "plan" | "background" | "goal" | "undo" | "voice";

interface DemoProps {
  mode?: ComposerMode;
  working?: boolean;
  draft?: string;
  placeholder?: string;
  tabs?: Tab[];
  openTab?: Tab | null;
  request?: RequestView;
  requestCount?: number;
  draftKept?: boolean;
  notice?: ReactNode;
  queue?: ReactNode;
  header?: ReactNode;
  error?: ReactNode;
  primary?: ComposerPrimaryView & { disabled?: boolean; busy?: boolean };
  preview?: ComposerPrimaryView;
  context?: number;
  approvals?: "full" | null;
  unavailable?: boolean;
  width?: number;
}

function DemoComposer({
  mode = "message",
  working = false,
  draft = "",
  placeholder = "Ask anything…",
  tabs = [],
  openTab = null,
  request,
  requestCount = 1,
  draftKept = false,
  notice,
  queue,
  header,
  error,
  primary,
  preview,
  context = 0.34,
  approvals = null,
  unavailable = false,
  width = WIDTH,
}: DemoProps) {
  const [tab, setTab] = useState<string | null>(openTab);
  const [text, setText] = useState(draft);
  const [answer, setAnswer] = useState<QuestionAnswer>(EMPTY_ANSWER);
  const [values, setValues] = useState<FormValues>({});
  const [feedback, setFeedback] = useState("");
  const [page, setPage] = useState(0);
  const slot = request ? "request" : tab;
  const fieldPlaceholder = request
    ? draftKept
      ? placeholder
      : request.kind === "permission"
        ? "Tell the agent what to do differently…"
        : request.kind === "question"
          ? "Type your own answer…"
          : placeholder
    : mode === "shell"
      ? "Run a shell command"
      : placeholder;
  const view = primary ?? {
    kind: working ? ("stop" as const) : ("send" as const),
    label: working ? "Stop" : "Send",
    disabled: !working && !text,
  };
  return (
    <ComposerDock style={{ width, maxWidth: "100%" }} className="mx-0">
      {notice}
      {tabs.length ? (
        <ComposerTabs value={request ? null : tab} onValueChange={setTab} inactive={!!request}>
          {tabs.map((id) => (
            <DemoTab key={id} id={id} />
          ))}
        </ComposerTabs>
      ) : null}
      <Composer mode={request ? "request" : mode}>
        <ComposerPanel
          open={slot !== null}
          onOpenChange={(open) => !open && setTab(null)}
          aria-label={slot ?? undefined}
        >
          {request ? (
            <RequestPanel
              key={request.id}
              request={request}
              index={page}
              count={requestCount}
              onPage={(delta) => setPage((page + delta + requestCount) % requestCount)}
              guard={{ field: draftKept ? "message" : "feedback", armed: true }}
              fieldEmpty={!text}
              feedback={feedback}
              onFeedbackChange={setFeedback}
              answer={answer}
              onAnswerChange={setAnswer}
              onNext={() =>
                setAnswer((current) => ({ ...current, step: Math.min(current.step + 1, 1) }))
              }
              values={values}
              onValuesChange={setValues}
              sendInsteadLabel="Steer it instead"
              onSendInstead={() => setText("")}
            />
          ) : tab ? (
            <DemoPanel key={tab} id={tab as Tab} />
          ) : null}
        </ComposerPanel>
        {queue}
        {header}
        <ComposerInputArea>
          <textarea
            aria-label="Message the agent"
            rows={1}
            value={text}
            placeholder={fieldPlaceholder}
            className="block w-full resize-none bg-transparent outline-none [field-sizing:content]"
            onChange={(event) => setText(event.target.value)}
          />
        </ComposerInputArea>
        {error}
        <ComposerFooter>
          <ComposerActions align="start">
            {mode === "shell" ? (
              <ComposerPill tone="default" className="rounded-full bg-secondary px-2.5">
                <SquareTerminal aria-hidden="true" />
                <ComposerPillLabel>Shell</ComposerPillLabel>
                <X aria-hidden="true" className="size-3!" />
              </ComposerPill>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  aria-label="Add files, commands and more"
                >
                  <Plus aria-hidden="true" className="size-4" />
                </Button>
                <ComposerPill compact="icon" aria-label="Agent: Build. Change agent">
                  <Hammer aria-hidden="true" />
                  <ComposerPillLabel>Build</ComposerPillLabel>
                  <ComposerPillChevron />
                </ComposerPill>
                {approvals ? (
                  <ComposerPill tone="warning" compact="icon" aria-label="Approvals: Full access">
                    <ShieldAlert aria-hidden="true" />
                    <ComposerPillLabel>Full access</ComposerPillLabel>
                  </ComposerPill>
                ) : null}
              </>
            )}
          </ComposerActions>
          <ComposerActions align="end">
            {mode === "shell" ? null : (
              <ComposerPill
                tone={unavailable ? "unavailable" : "default"}
                aria-label="Model: Claude Sonnet 4.6, effort High"
              >
                {unavailable ? <TriangleAlert aria-hidden="true" /> : null}
                <ComposerPillLabel>Claude Sonnet 4.6</ComposerPillLabel>
                <ComposerPillDetail>High</ComposerPillDetail>
                <ComposerPillChevron />
              </ComposerPill>
            )}
            <ComposerFoldable value="context" priority={2}>
              <ComposerContextPie value={context} />
            </ComposerFoldable>
            <ComposerFoldable value="voice" priority={1}>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label="Start voice call"
              >
                <Mic aria-hidden="true" className="size-4" />
              </Button>
            </ComposerFoldable>
            <ComposerOverflow>
              <ComposerOverflowItem value="context">
                <ComposerContextPieGlyph value={context} className="size-3.5" />
                Context {Math.round(context * 100)}% full · Compact
              </ComposerOverflowItem>
              <ComposerOverflowItem value="voice">
                <Mic aria-hidden="true" />
                Start voice call
              </ComposerOverflowItem>
            </ComposerOverflow>
            <ComposerPrimary
              kind={view.kind}
              label={view.label}
              shortcut={view.shortcut}
              disabled={view.disabled}
              busy={view.busy}
              preview={preview}
            />
            {working && view.kind !== "stop" ? <ComposerStop /> : null}
          </ComposerActions>
        </ComposerFooter>
      </Composer>
      <p className="m-0 flex items-center gap-1.5 px-6 pt-2 text-meta text-muted-foreground">
        Worktree · feature/turns
      </p>
    </ComposerDock>
  );
}

function DemoTab({ id }: { id: Tab }) {
  switch (id) {
    case "plan":
      return (
        <ComposerTab value="plan">
          <ListChecks aria-hidden="true" />
          <ComposerTabLabel>Plan · 3/7</ComposerTabLabel>
          <ComposerTabDetail>Running the e2e suite</ComposerTabDetail>
        </ComposerTab>
      );
    case "background":
      return (
        <ComposerTab value="background">
          <PulseDot className="-mx-0.5 size-3.5" />
          <ComposerTabLabel>2 running</ComposerTabLabel>
        </ComposerTab>
      );
    case "undo":
      return (
        <ComposerTab value="undo">
          <Undo2 aria-hidden="true" />
          <ComposerTabLabel>Undo staged · 3 files</ComposerTabLabel>
        </ComposerTab>
      );
    case "goal":
      return (
        <ComposerTab value="goal">
          <Target aria-hidden="true" />
          <ComposerTabLabel>Goal · round 2 of 5</ComposerTabLabel>
        </ComposerTab>
      );
    case "voice":
      return (
        <ComposerTab value="voice" tone="live">
          <ComposerTabLabel>Voice · live</ComposerTabLabel>
        </ComposerTab>
      );
  }
}

function DemoPanel({ id }: { id: Tab }) {
  switch (id) {
    case "plan":
      return <PlanPanel items={PLAN} />;
    case "background":
      return (
        <BackgroundWorkPanel
          items={[
            {
              id: "a",
              kind: "agent",
              label: "explore · Find every use of COLLAPSE_AFTER",
              elapsed: "1m 12s",
            },
            { id: "b", kind: "command", label: "bun run test:e2e -- composer", elapsed: "42s" },
            { id: "c", kind: "terminal", label: "vp dev", finished: true },
          ]}
          onStopAll={() => {}}
        />
      );
    case "goal":
      return (
        <GoalPanel
          goal={{
            objective: "Every composer e2e scenario passes on Linux and macOS.",
            status: "active",
            round: 2,
            rounds: 5,
            reason: "last review: “snapshots still fail on macOS”",
          }}
        />
      );
    case "undo":
      return <UndoStagedPanel files={["composer-queue.tsx", "composer.test.tsx", "DESIGN.md"]} />;
    case "voice":
      return (
        <VoicePanel
          voice={{
            phase: "listening",
            micMuted: false,
            elapsed: "1m 04s",
            caption: "…and then run the composer suite again on Linux",
          }}
        />
      );
  }
}

const QUEUE_TWO = (
  <ComposerQueue>
    <ComposerQueueRow aria-label="Queued: Also check the queue collapse at three messages.">
      <Clock3 aria-hidden="true" />
      <ComposerQueueRowText>Also check the queue collapse at three messages.</ComposerQueueRowText>
      <QueueActions pinned />
    </ComposerQueueRow>
    <ComposerQueueRow aria-label="Queued: Then update @DESIGN.md for the new dock.">
      <Clock3 aria-hidden="true" />
      <ComposerQueueRowText>Then update @DESIGN.md for the new dock.</ComposerQueueRowText>
      <QueueActions />
    </ComposerQueueRow>
  </ComposerQueue>
);

function QueueActions({ pinned = false }: { pinned?: boolean }) {
  return (
    <ComposerQueueRowActions>
      <Button
        size="xs"
        variant="ghost"
        className="text-meta!"
        data-pinned={pinned ? "" : undefined}
      >
        Steer now
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="Edit queued message">
        <Pencil aria-hidden="true" />
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="Remove queued message">
        <X aria-hidden="true" />
      </Button>
    </ComposerQueueRowActions>
  );
}

const QUEUE_STATES = (
  <ComposerQueue>
    <ComposerQueueRow state="paused" aria-label="Queue paused">
      <Pause aria-hidden="true" />
      <ComposerQueueRowText>
        Queue paused
        <span className="text-muted-foreground"> · the agent stopped with 3 waiting</span>
      </ComposerQueueRowText>
      <ComposerQueueRowActions>
        <Button size="xs" variant="outline" className="text-meta!" data-pinned="">
          Resume
        </Button>
        <Button size="xs" variant="ghost" className="text-meta!" data-pinned="">
          Clear
        </Button>
      </ComposerQueueRowActions>
    </ComposerQueueRow>
    <ComposerQueueRow state="blocked" aria-label="Queued: Skip the Windows-only tests for now.">
      <Hourglass aria-hidden="true" />
      <ComposerQueueRowText>Skip the Windows-only tests for now.</ComposerQueueRowText>
      <QueueActions />
      <ComposerQueueRowStatus>
        <span className="min-w-0 truncate">
          Waiting for{" "}
          <code className="font-mono text-code-compact text-foreground/80">bun test</code> to finish
        </span>
        <span aria-hidden="true">·</span>
        <button type="button" className="shrink-0 font-medium text-foreground/80 hover:underline">
          Send it to the background
        </button>
      </ComposerQueueRowStatus>
    </ComposerQueueRow>
    <ComposerQueueRow state="editing" aria-label="Editing a queued message">
      <Pencil aria-hidden="true" />
      <ComposerQueueRowText>Editing in the message box</ComposerQueueRowText>
      <ComposerQueueRowActions>
        <Button size="xs" variant="ghost" className="text-meta!">
          Cancel
        </Button>
      </ComposerQueueRowActions>
    </ComposerQueueRow>
  </ComposerQueue>
);

const QUEUE_COLLAPSED = (
  <ComposerQueue>
    <ComposerQueueSummary aria-expanded={false}>
      <Clock3 aria-hidden="true" />
      <span className="text-foreground">3 queued</span>
      <span className="min-w-0 flex-1 truncate">
        · next: Also check the queue collapse at three messages.
      </span>
    </ComposerQueueSummary>
  </ComposerQueue>
);

const HEADER = (
  <ComposerHeader aria-label="Attachments and comments">
    <Attachment size="sm" className="max-w-72 bg-background/55">
      <AttachmentMedia variant="image">
        <div className="size-full bg-linear-to-br from-info to-chart-4" />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>queue-strip.png</AttachmentTitle>
        <AttachmentDescription>PNG · 284 KB</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label="Remove queue-strip.png">
          <X aria-hidden="true" />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
    <Attachment size="sm" state="uploading" className="max-w-72 bg-background/55">
      <AttachmentMedia>
        <FileText aria-hidden="true" />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>Uploading trace.json</AttachmentTitle>
        <AttachmentDescription>64%</AttachmentDescription>
      </AttachmentContent>
    </Attachment>
    <Attachment size="sm" className="max-w-80 bg-background/55">
      <AttachmentMedia>
        <MessageSquareCode aria-hidden="true" />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle className="font-mono text-code-compact text-muted-foreground">
          composer-queue.tsx:88
        </AttachmentTitle>
        <AttachmentDescription className="text-foreground">
          Collapse after three, not two.
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label="Remove comment">
          <X aria-hidden="true" />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  </ComposerHeader>
);

const ERROR = (
  <ComposerError>
    <CircleAlert aria-hidden="true" />
    <span className="min-w-0 truncate">Claude Sonnet 4.6 is not available on this connection.</span>
    <button type="button" className="shrink-0 font-medium hover:underline">
      Pick another model
    </button>
  </ComposerError>
);

function ConnectionNotice() {
  return (
    <ComposerNotice tone="destructive">
      <WifiOff aria-hidden="true" />
      <ComposerNoticeText>Reconnecting to OpenCode… 2/5</ComposerNoticeText>
      <ComposerNoticeAction>Retry now</ComposerNoticeAction>
      <ComposerNoticeMore aria-label="1 more: Context nearly full. Show next">
        +1
      </ComposerNoticeMore>
    </ComposerNotice>
  );
}

function ContextNotice() {
  const [choice, setChoice] = useState("compact");
  return (
    <ComposerNotice tone="warning">
      <CircleGauge aria-hidden="true" />
      <ComposerNoticeText>Context 91% full</ComposerNoticeText>
      <ToggleGroup
        variant="segmented"
        size="sm"
        aria-label="Before sending"
        value={[choice]}
        onValueChange={(value) => value[0] && setChoice(value[0])}
      >
        <ToggleGroupItem value="compact">Compact first</ToggleGroupItem>
        <ToggleGroupItem value="as-is">Send as is</ToggleGroupItem>
      </ToggleGroup>
    </ComposerNotice>
  );
}

const STEER: ComposerPrimaryView = { kind: "steer", label: "Steer", shortcut: ["Enter"] };
const QUEUE: ComposerPrimaryView = { kind: "queue", label: "Queue", shortcut: ["Mod", "Enter"] };

const FRAMES: { id: string; title: string; render: () => ReactNode }[] = [
  { id: "idle", title: "Idle, empty draft", render: () => <DemoComposer /> },
  {
    id: "busy",
    title: "Working, two queued, plan, background and goal (hold Mod: Queue)",
    render: () => (
      <DemoComposer
        working
        draft="When that passes, run the typecheck too."
        tabs={["plan", "background", "goal"]}
        queue={QUEUE_TWO}
        primary={STEER}
        preview={QUEUE}
        context={0.78}
      />
    ),
  },
  {
    id: "plan",
    title: "Plan tab open",
    render: () => (
      <DemoComposer working tabs={["plan"]} openTab="plan" placeholder="Add a follow-up" />
    ),
  },
  {
    id: "standing",
    title: "Background work open; undo, goal and voice tabs",
    render: () => (
      <DemoComposer
        working
        tabs={["voice", "background", "undo", "goal"]}
        openTab="background"
        placeholder="Add a follow-up"
      />
    ),
  },
  {
    id: "shell",
    title: "Permission: shell command, empty field (the field is feedback)",
    render: () => (
      <DemoComposer
        working
        request={SHELL}
        tabs={["plan", "goal"]}
        primary={{ kind: "allow", label: "Allow once", shortcut: ["Enter"] }}
      />
    ),
  },
  {
    id: "edit",
    title: "Permission: file edit with a diff, two pending",
    render: () => (
      <DemoComposer
        working
        request={EDIT}
        requestCount={2}
        primary={{ kind: "allow", label: "Allow once", shortcut: ["Enter"] }}
      />
    ),
  },
  {
    id: "question",
    title: "Question in two steps from a subagent, draft kept (panel owns its answer)",
    render: () => (
      <DemoComposer
        working
        request={STEPS}
        draftKept
        draft="When the suite passes, open a PR with the changelog line."
        primary={STEER}
      />
    ),
  },
  {
    id: "form",
    title: "Form from an MCP server",
    render: () => <DemoComposer working request={FORM} placeholder="Add a follow-up" />,
  },
  {
    id: "guest",
    title: "Guest message",
    render: () => <DemoComposer working request={GUEST} placeholder="Add a follow-up" />,
  },
  {
    id: "notice",
    title: "Connection lost (+1 waiting)",
    render: () => (
      <DemoComposer
        working
        notice={<ConnectionNotice />}
        context={0.91}
        placeholder="Add a follow-up"
      />
    ),
  },
  {
    id: "context",
    title: "Context nearly full",
    render: () => (
      <DemoComposer
        notice={<ContextNotice />}
        context={0.91}
        draft="Summarise what changed."
        primary={{ kind: "send", label: "Send", shortcut: ["Enter"] }}
      />
    ),
  },
  {
    id: "message",
    title: "Attachments, upload, comment and an error",
    render: () => (
      <DemoComposer
        draft="Use the screenshot as the reference."
        header={HEADER}
        error={ERROR}
        unavailable
        primary={{ kind: "send", label: "Send", shortcut: ["Enter"] }}
      />
    ),
  },
  {
    id: "queue",
    title: "Queue paused, blocked steer and editing",
    render: () => (
      <DemoComposer
        queue={QUEUE_STATES}
        draft="Skip the Windows-only tests for now."
        primary={{ kind: "update", label: "Update", shortcut: ["Enter"] }}
        approvals="full"
      />
    ),
  },
  {
    id: "collapsed",
    title: "Three queued (collapsed), resume",
    render: () => (
      <DemoComposer queue={QUEUE_COLLAPSED} primary={{ kind: "resume", label: "Resume" }} />
    ),
  },
  {
    id: "shell-mode",
    title: "Shell mode",
    render: () => (
      <DemoComposer
        mode="shell"
        draft="git status --short"
        primary={{ kind: "run", label: "Run", shortcut: ["Enter"] }}
      />
    ),
  },
  {
    id: "narrow",
    title: "Everything at 380 px: labels drop, pie and mic fold, tabs fold into +N",
    render: () => (
      <DemoComposer
        working
        width={380}
        notice={<ContextNotice />}
        tabs={["plan", "background", "undo", "goal"]}
        queue={QUEUE_COLLAPSED}
        draft="When the suite passes, open a PR with the changelog line."
        primary={STEER}
        context={0.91}
        approvals="full"
      />
    ),
  },
];

export function Showcase() {
  const frames = ONLY ? FRAMES.filter((frame) => frame.id === ONLY) : FRAMES;
  return (
    <TooltipProvider>
      <main className="flex min-h-screen flex-col gap-10 bg-background px-6 py-8 text-foreground">
        <header className="flex flex-col gap-1">
          <h1 className="m-0 text-page-title font-semibold">Composer primitives</h1>
          <p className="m-0 text-compact text-muted-foreground">
            The real parts from <code>components/ui/composer.tsx</code> and{" "}
            <code>components/composer-dock/</code> with static data. Width {WIDTH}px.
          </p>
        </header>
        {frames.map((frame) => (
          <section key={frame.id} data-frame={frame.id} className="flex flex-col gap-3">
            <h2 className="m-0 flex items-center gap-2 text-meta font-medium text-muted-foreground">
              {frame.id === "standing" ? (
                <AudioLines aria-hidden="true" className="size-3.5" />
              ) : null}
              {frame.title}
            </h2>
            {frame.render()}
          </section>
        ))}
      </main>
    </TooltipProvider>
  );
}
