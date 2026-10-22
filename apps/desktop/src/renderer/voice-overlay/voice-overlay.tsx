import { useEffect, useState } from "react";
import { ThinkingOrb, type OrbState } from "@palot/orbits";
import { Mic, MicOff, PhoneOff, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  IDLE_VOICE_CALL_SNAPSHOT,
  type PalotVoiceOverlayApi,
  type VoiceActivity,
  type VoiceAudioLevels,
  type VoiceCallSnapshot,
  type VoiceOverlayCommand,
} from "../../shared/voice-contract";

const ORB_STATES: Record<VoiceActivity, OrbState> = {
  connecting: "connecting",
  listening: "listening",
  thinking: "breathing",
  speaking: "composing",
};

const ACTIVITY_LABELS: Record<VoiceActivity, string> = {
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

function statusLine(snapshot: VoiceCallSnapshot): { text: string; error: boolean } {
  if (snapshot.error) return { text: snapshot.error, error: true };
  if (snapshot.phase === "stopping") return { text: "Ending call…", error: false };
  if (snapshot.outputMuted && snapshot.caption) return { text: snapshot.caption, error: false };
  if (snapshot.status) return { text: snapshot.status, error: false };
  return { text: ACTIVITY_LABELS[snapshot.activity], error: false };
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function VoiceOverlay({ api }: { api: PalotVoiceOverlayApi }) {
  const [snapshot, setSnapshot] = useState<VoiceCallSnapshot>(IDLE_VOICE_CALL_SNAPSHOT);
  const [levels, setLevels] = useState<VoiceAudioLevels>({ input: 0, output: 0 });
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    let active = true;
    // Subscribe before asking for the snapshot so no push is missed in between.
    const offState = api.onState((next) => {
      if (active) setSnapshot(next);
    });
    const offLevels = api.onLevels((next) => {
      if (active) setLevels(next);
    });
    void api
      .ready()
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      offState();
      offLevels();
    };
  }, [api]);

  const send = (command: VoiceOverlayCommand) => {
    void api.command(command).catch(() => undefined);
  };
  const line = statusLine(snapshot);
  const title = snapshot.title?.trim() || "Voice chat";
  const level =
    snapshot.activity === "speaking"
      ? levels.output
      : snapshot.activity === "listening" && !snapshot.micMuted
        ? levels.input
        : 0;
  const ending = snapshot.phase === "stopping";

  return (
    <div
      className="flex h-full w-full items-center gap-2.5 overflow-hidden rounded-2xl border border-border bg-popover pr-2 pl-3 text-popover-foreground [-webkit-app-region:drag]"
      data-phase={snapshot.phase}
    >
      <div
        className="flex size-11 shrink-0 items-center justify-center transition-transform duration-100 ease-out"
        style={reducedMotion ? undefined : { transform: `scale(${1 + level * 0.12})` }}
      >
        <ThinkingOrb
          state={ORB_STATES[snapshot.activity]}
          size={44}
          paused={ending}
          aria-label={ACTIVITY_LABELS[snapshot.activity]}
        />
      </div>
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col items-start rounded-md text-left outline-none [-webkit-app-region:no-drag] focus-visible:ring-2 focus-visible:ring-ring/30"
        onClick={() => send({ type: "open-session" })}
        title={`Open ${title}`}
        aria-label={`Open ${title}`}
      >
        <span className="w-full truncate text-sm font-medium">{title}</span>
        <span
          className={cn(
            "w-full truncate text-meta",
            line.error ? "text-destructive" : "text-muted-foreground",
          )}
          aria-live="polite"
        >
          {line.text}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={snapshot.micMuted ? "Unmute microphone" : "Mute microphone"}
          title={snapshot.micMuted ? "Unmute microphone" : "Mute microphone"}
          aria-pressed={snapshot.micMuted}
          disabled={ending}
          onClick={() => send({ type: "toggle-mic" })}
        >
          {snapshot.micMuted ? <MicOff /> : <Mic />}
        </Button>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={snapshot.outputMuted ? "Unmute voice replies" : "Mute voice replies"}
          title={snapshot.outputMuted ? "Unmute voice replies" : "Mute voice replies"}
          aria-pressed={snapshot.outputMuted}
          disabled={ending}
          onClick={() => send({ type: "toggle-output" })}
        >
          {snapshot.outputMuted ? <VolumeX /> : <Volume2 />}
        </Button>
        <Button
          variant="destructive"
          size="icon-lg"
          aria-label="End call"
          title="End call"
          disabled={ending}
          onClick={() => send({ type: "end" })}
        >
          <PhoneOff />
        </Button>
      </div>
    </div>
  );
}
