import type { IpcMainInvokeEvent } from "electron";
import * as v from "valibot";
import {
  PROJECT_SCRIPT_LIMITS,
  PROJECT_SCRIPTS_IPC_CHANNELS,
} from "../../shared/project-scripts-contract";
import type { ProjectScriptsService } from "./service";

type Register = (
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void;

const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(512));
const target = { profileID: identifier, projectID: identifier };

export const projectScriptsSchemas = {
  load: v.strictObject(target),
  save: v.strictObject({
    ...target,
    script: v.strictObject({
      id: v.optional(identifier),
      // Trimmed and checked again in main; these bounds only reject absurd payloads.
      name: v.pipe(v.string(), v.maxLength(PROJECT_SCRIPT_LIMITS.name * 4)),
      command: v.pipe(v.string(), v.maxLength(PROJECT_SCRIPT_LIMITS.command * 4)),
      runOnSettle: v.boolean(),
      timeoutSeconds: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(PROJECT_SCRIPT_LIMITS.minTimeoutSeconds),
        v.maxValue(PROJECT_SCRIPT_LIMITS.maxTimeoutSeconds),
      ),
    }),
  }),
  remove: v.strictObject({ ...target, scriptID: identifier }),
};

/**
 * Registers the project script channels through the caller's trusted registrar, so they share
 * the main-window, main-frame and renderer-document checks of every other Palot handler.
 */
export function registerProjectScriptsIpc(
  register: Register,
  service: () => ProjectScriptsService,
): void {
  const channels = PROJECT_SCRIPTS_IPC_CHANNELS;
  register(channels.projectScriptsLoad, (_event, input) =>
    service().load(v.parse(projectScriptsSchemas.load, input)),
  );
  register(channels.projectScriptsSave, (_event, input) =>
    service().save(v.parse(projectScriptsSchemas.save, input)),
  );
  register(channels.projectScriptsRemove, (_event, input) =>
    service().remove(v.parse(projectScriptsSchemas.remove, input)),
  );
}
