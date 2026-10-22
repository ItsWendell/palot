import { ThinkingOrb, type OrbState } from "@palot/orbits";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Mic, MicOff, PhoneOff, Volume2, VolumeX } from "lucide-react";
import type { PalotSession, VoiceActivity } from "../../../shared";
import { useVoiceCall, useVoiceLevels } from "../../hooks/use-voice-call";
import { formatShortcut, useShortcutKeys } from "../../lib/keyboard-shortcuts";
import { cn } from "../../lib/cn";
import { spring } from "../../lib/springs";
import {
  VOICE_COORDINATOR_AGENT,
  voiceCall,
  type VoiceCallTarget,
} from "../../services/voice-call";
import { Button } from "../ui/button";
import { InputGroupButton } from "../ui/input-group";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

const ORB_STATES: Record<VoiceActivity, OrbState> = {
  connecting: "connecting",
  listening: "listening",
  thinking: "breathing",
  speaking: "composing",
};

const ACTIVITY_LABELS: Record<VoiceActivity, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Working on it",
  speaking: "Speaking",
};

/** The call orb. Live audio levels gently scale and speed it up. */
export function VoiceOrb({ size, activity }: { size: number; activity: VoiceActivity }) {
  const levels = useVoiceLevels();
  const energy = Math.max(levels.output, levels.input * 0.7);
  return (
    <div
      className="grid place-items-center transition-transform duration-75 ease-out motion-reduce:transition-none"
      style={{ transform: `scale(${1 + energy * 0.16})` }}
    >
      <ThinkingOrb
        state={ORB_STATES[activity]}
        size={size}
        speed={1 + energy * 1.2}
        aria-label={ACTIVITY_LABELS[activity]}
      />
    </div>
  );
}

function CallControls({ compact = false }: { compact?: boolean }) {
  const { snapshot } = useVoiceCall();
  const size = compact ? "icon-xs" : "icon-sm";
  const starting = snapshot.phase === "starting";
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Voice chat controls">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size={size}
              aria-pressed={snapshot.micMuted}
              aria-label={snapshot.micMuted ? "Unmute microphone" : "Mute microphone"}
              disabled={starting}
              onClick={() => voiceCall.toggleMicrophone()}
            />
          }
        >
          {snapshot.micMuted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
        </TooltipTrigger>
        <TooltipContent>
          {snapshot.micMuted ? "Unmute microphone" : "Mute microphone"}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size={size}
              aria-pressed={snapshot.outputMuted}
              aria-label={snapshot.outputMuted ? "Unmute voice" : "Mute voice and show captions"}
              disabled={starting}
              onClick={() => voiceCall.toggleOutput()}
            />
          }
        >
          {snapshot.outputMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </TooltipTrigger>
        <TooltipContent>
          {snapshot.outputMuted ? "Unmute voice" : "Mute voice and show captions"}
        </TooltipContent>
      </Tooltip>
      <Button
        type="button"
        variant="destructive"
        size={compact ? "xs" : "sm"}
        onClick={() => void voiceCall.end()}
        disabled={snapshot.phase === "stopping"}
      >
        <PhoneOff aria-hidden="true" data-icon="inline-start" />
        {starting ? "Cancel" : snapshot.phase === "stopping" ? "Ending…" : "End"}
      </Button>
    </div>
  );
}

/** Sits above the composer while this task is in a voice chat. */
export function VoiceStage({ sessionID }: { sessionID: string }) {
  const { snapshot } = useVoiceCall();
  const visible = snapshot.phase !== "idle" && snapshot.sessionID === sessionID;
  const detail =
    snapshot.phase === "starting"
      ? "Starting voice chat"
      : snapshot.phase === "stopping"
        ? "Ending voice chat…"
        : snapshot.outputMuted && snapshot.caption
          ? snapshot.caption
          : (snapshot.status ?? ACTIVITY_LABELS[snapshot.activity]);
  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.section
          key="voice-stage"
          aria-label="Voice chat"
          className="pointer-events-auto mx-auto mb-2 flex w-full max-w-md flex-col items-center gap-2 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-sm backdrop-blur-sm"
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={spring.moderate}
          data-palot-voice-stage
        >
          <VoiceOrb size={64} activity={snapshot.activity} />
          <p
            className={cn(
              "max-w-full text-center text-meta text-muted-foreground",
              snapshot.outputMuted && snapshot.caption
                ? "line-clamp-3 text-foreground"
                : "truncate",
            )}
            aria-live="polite"
          >
            {detail}
          </p>
          <CallControls />
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

/** Composer action: start a voice chat in this task, or end the one running here. */
export function VoiceCallButton({
  session,
  connectionID,
  projectName,
  supported,
}: {
  session: PalotSession;
  connectionID: string | null;
  projectName: string | null;
  supported: boolean;
}) {
  const { snapshot } = useVoiceCall();
  const shortcut = useShortcutKeys("task.voice.toggle");
  if (!supported || !connectionID) return null;
  const here = snapshot.sessionID === session.id;
  const busyElsewhere = snapshot.phase !== "idle" && !here;
  const label =
    snapshot.phase === "idle"
      ? "Start voice chat"
      : busyElsewhere
        ? "Voice chat is active in another task"
        : snapshot.phase === "starting"
          ? "Cancel voice chat"
          : "End voice chat";
  const target: VoiceCallTarget = {
    connectionID,
    sessionID: session.id,
    title: session.title,
    projectName,
    coordinator: session.agent === VOICE_COORDINATOR_AGENT,
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InputGroupButton
            type="button"
            size="icon-sm"
            aria-label={label}
            aria-pressed={here && snapshot.phase !== "idle"}
            aria-keyshortcuts={shortcut.join("+")}
            className={cn(here && snapshot.phase !== "idle" && "text-destructive")}
            onClick={() => {
              if (busyElsewhere) voiceCall.openSession();
              else if (snapshot.phase === "idle") void voiceCall.start(target);
              else void voiceCall.end();
            }}
            data-palot-voice-button
          />
        }
      >
        {here && snapshot.phase === "starting" ? (
          <Spinner aria-hidden="true" />
        ) : here && snapshot.phase !== "idle" ? (
          <PhoneOff aria-hidden="true" />
        ) : (
          <Mic aria-hidden="true" />
        )}
      </TooltipTrigger>
      <TooltipContent>
        {busyElsewhere ? `${label} · Open it` : `${label} · ${formatShortcut(shortcut)}`}
      </TooltipContent>
    </Tooltip>
  );
}

/** Keeps an ongoing call reachable while another task or page is open. */
export function VoiceCallPill({ currentSessionID }: { currentSessionID: string | null }) {
  const { snapshot } = useVoiceCall();
  const visible = snapshot.phase !== "idle" && snapshot.sessionID !== currentSessionID;
  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          key="voice-pill"
          className="fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-2 rounded-full border border-border bg-popover py-1 pr-1.5 pl-1.5 text-popover-foreground shadow-md"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={spring.moderate}
          role="region"
          aria-label="Voice chat"
          data-palot-voice-pill
        >
          <VoiceOrb size={20} activity={snapshot.activity} />
          <button
            type="button"
            className="flex min-w-0 items-center gap-1 rounded-md px-1 text-left text-compact outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => voiceCall.openSession()}
            aria-label={`Open voice chat task${snapshot.title ? ` ${snapshot.title}` : ""}`}
          >
            <span className="truncate">{snapshot.title ?? "Voice chat"}</span>
            <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
          <span className="truncate text-meta text-muted-foreground">
            {snapshot.status ?? ACTIVITY_LABELS[snapshot.activity]}
          </span>
          <CallControls compact />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
