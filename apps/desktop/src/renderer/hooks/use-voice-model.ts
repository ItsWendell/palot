import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import {
  chooseVoiceModel,
  supportsVoiceModels,
  voiceModelsQueryOptions,
  type VoiceModelChoice,
} from "../lib/voice/voice-models";

/** The voice model a call on the current connection would start, read from the server. */
export function useVoiceModel(): VoiceModelChoice {
  const runtime = useAtomValue(runtimeAtom);
  const listed = supportsVoiceModels(runtime?.version) !== false;
  const query = useQuery(
    voiceModelsQueryOptions(
      runtime?.connectionID ?? "disconnected",
      listed && canFetchOpenCode(runtime),
    ),
  );
  return chooseVoiceModel(listed ? query.data : undefined);
}
