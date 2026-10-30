import type { PalotModel, PalotSession } from "../../shared";

export interface ModelTaskResult {
  model: PalotModel;
  session: PalotSession | null;
  sent: boolean;
  error?: string;
}

/** No automatic retry: once a send is attempted its receipt can be uncertain. */
export async function sendToSeveralModels(input: {
  models: PalotModel[];
  text: string;
  create(model: PalotModel, title: string): Promise<PalotSession | null>;
  send(session: PalotSession, model: PalotModel): Promise<unknown>;
}): Promise<ModelTaskResult[]> {
  const keys = new Set(input.models.map((model) => JSON.stringify([model.providerID, model.id])));
  if (keys.size !== input.models.length || keys.size < 2 || keys.size > 4)
    throw new Error("Choose two to four different models.");
  const prefix = `Compare ${crypto.randomUUID().slice(0, 6)} · ${input.text.trim().replace(/\s+/g, " ").slice(0, 60) || "Attached context"}`;
  const results: ModelTaskResult[] = [];
  // Serial creation bounds worktree provisioning and makes partial failures inspectable.
  for (const model of input.models) {
    let session: PalotSession | null = null;
    try {
      session = await input.create(model, `${prefix} · ${model.name}`);
      if (!session) throw new Error("The task was not created.");
      await input.send(session, model);
      results.push({ model, session, sent: true });
    } catch (error) {
      results.push({
        model,
        session,
        sent: false,
        error: error instanceof Error ? error.message : "Could not send this task.",
      });
    }
  }
  return results;
}
