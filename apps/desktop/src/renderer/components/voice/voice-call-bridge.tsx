import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef } from "react";
import type { PalotSession } from "../../../shared";
import { runtimeAtom, type SessionExecutionState } from "../../atoms/workspace";
import { voicePreferencesAtom } from "../../atoms/voice";
import {
  useProjectCatalog,
  useCatalogSession,
  useSelectedSession,
} from "../../hooks/use-session-catalog";
import { useSessionActivityForSession } from "../../hooks/use-session-activity";
import { useSessionFamilyRequestViews } from "../../hooks/use-session-requests";
import { useSessionTranscript } from "../../hooks/use-session-transcript";
import { useSessionTranscriptProjection } from "../../hooks/use-session-transcript-projection";
import { useVoiceCall } from "../../hooks/use-voice-call";
import { SESSION_PROJECTION_PRESETS } from "../../lib/session-projection-policy";
import { withPersistedTurnFailures } from "../../lib/persisted-turn-failures";
import { supportsOpenCodeVoice } from "../../lib/voice/voice-support";
import { VOICE_COORDINATOR_AGENT, voiceCall } from "../../services/voice-call";
import { toast } from "../ui/toast";
import { VoiceCallPill } from "./voice-call-ui";

const EMPTY_EXECUTION = new Map<string, SessionExecutionState>();

function projectName(
  session: PalotSession,
  projects: ReturnType<typeof useProjectCatalog>,
): string | null {
  const project = projects.find((candidate) => candidate.id === session.projectID);
  if (project?.name) return project.name;
  const directory = session.location.directory.replace(/\/+$/, "");
  return directory.split("/").at(-1) || null;
}

/** Keeps the call's session under observation and feeds agent progress to the voice relay. */
function VoiceSessionObserver({
  session,
  connectionID,
}: {
  session: PalotSession;
  connectionID: string;
}) {
  "use no memo";
  const transcript = useSessionTranscript(session);
  const activity = useSessionActivityForSession(session.id).data;
  const requests = useSessionFamilyRequestViews(session.id);
  const executionStates = activity?.execution ?? EMPTY_EXECUTION;
  const execution = executionStates.get(session.id) ?? null;
  const runtimeStatus = activity?.status ?? null;
  const messages = useMemo(
    () => withPersistedTurnFailures(transcript.messages),
    [transcript.messages],
  );
  const projection = useSessionTranscriptProjection({
    connectionID: transcript.connectionID,
    sessionID: session.id,
    messages,
    execution,
    requests,
    diffs: [],
    runtimeStatus,
    initialLocation: session.location,
    policy: SESSION_PROJECTION_PRESETS.compact,
  });
  const busy =
    runtimeStatus?.type === "busy" ||
    runtimeStatus?.type === "retry" ||
    [...executionStates.values()].some((state) => state.status === "running");
  const turns = useMemo(() => projection.rows.map((row) => row.turn), [projection.rows]);

  useEffect(() => {
    voiceCall.observe({ connectionID, sessionID: session.id }, { turns, requests, busy });
  }, [busy, connectionID, requests, session.id, turns]);

  useEffect(() => {
    voiceCall.retitle(session.title);
  }, [session.title]);

  return null;
}

/**
 * Mounted once per window. Connects main-process voice commands, publishes overlay
 * and shortcut preferences, tracks where the shortcut starts a call, and observes
 * the active call's session regardless of the current route.
 */
export function VoiceCallBridge() {
  const runtime = useAtomValue(runtimeAtom);
  const preferences = useAtomValue(voicePreferencesAtom);
  const selected = useSelectedSession();
  const projects = useProjectCatalog();
  const call = useVoiceCall().snapshot;
  const callSession = useCatalogSession(call.phase === "idle" ? null : call.sessionID);
  const warnedShortcut = useRef<string | null>(null);
  const supported = supportsOpenCodeVoice(runtime?.version);

  useEffect(() => voiceCall.attachHost(), []);

  useEffect(() => {
    const voice = window.palot?.voice;
    if (!voice) return;
    void voice
      .configure({ overlay: preferences.overlay, globalShortcut: preferences.globalShortcut })
      .then((result) => {
        if (result.globalShortcutRegistered || !preferences.globalShortcut) return;
        if (warnedShortcut.current === preferences.globalShortcut) return;
        warnedShortcut.current = preferences.globalShortcut;
        toast.add({
          type: "warning",
          title: "Voice chat shortcut unavailable",
          description:
            "Another app or the system already uses that shortcut. Choose a different one in Settings → Voice.",
        });
      })
      .catch(() => undefined);
  }, [preferences.globalShortcut, preferences.overlay]);

  useEffect(() => {
    voiceCall.setLaunchTarget(
      supported && runtime?.connected && selected && !selected.archivedAt
        ? {
            connectionID: runtime.connectionID,
            sessionID: selected.id,
            title: selected.title,
            projectName: projectName(selected, projects),
            coordinator: selected.agent === VOICE_COORDINATOR_AGENT,
          }
        : null,
    );
  }, [projects, runtime?.connected, runtime?.connectionID, selected, supported]);

  const observing = callSession && runtime && runtime.connectionID === call.connectionID;
  return (
    <>
      {observing ? (
        <VoiceSessionObserver session={callSession} connectionID={runtime.connectionID} />
      ) : null}
      <VoiceCallPill currentSessionID={selected?.id ?? null} />
    </>
  );
}
