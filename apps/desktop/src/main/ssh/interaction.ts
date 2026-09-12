import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { IPC_CHANNELS } from "../../shared/opencode-contract";
import type { SshConnectionState, SshPrompt, SshPromptResponse } from "../../shared/ssh-contract";
import { connectSsh } from "./transport";

export type SshConnector = (
  input: Omit<Parameters<typeof connectSsh>[0], "onStage" | "prompt">,
) => ReturnType<typeof connectSsh>;

type Owner = Pick<WebContents, "id" | "isDestroyed" | "send" | "once" | "removeListener">;
interface Operation {
  owner: Owner;
  state: SshConnectionState;
  abort: AbortController;
  answer?: (value: string | null) => void;
}

/** Prompts belong to the invoking window, never the currently focused window. */
export class SshInteractions {
  private readonly operations = new Map<number, Operation>();

  constructor(private readonly transport: typeof connectSsh = connectSsh) {}

  state(owner: Owner): SshConnectionState | null {
    return structuredClone(this.operations.get(owner.id)?.state ?? null);
  }

  connector(owner: Owner): SshConnector {
    return async (input) => {
      if (owner.isDestroyed()) throw new Error("The SSH connection window was closed");
      if (this.operations.has(owner.id))
        throw new Error("An SSH connection is already in progress");
      const operation: Operation = {
        owner,
        abort: new AbortController(),
        state: {
          operationID: randomUUID(),
          target: input.config.target,
          stage: "Connecting",
          prompt: null,
        },
      };
      this.operations.set(owner.id, operation);
      const destroyed = () => operation.abort.abort(new Error("SSH connection canceled"));
      owner.once("destroyed", destroyed);
      owner.once("did-navigate", destroyed);
      const signal = AbortSignal.any([
        input.signal,
        operation.abort.signal,
        AbortSignal.timeout(15 * 60_000),
      ]);
      this.publish(operation);
      try {
        const connection = await this.transport({
          ...input,
          signal,
          onStage: (stage) => {
            operation.state.stage = stage;
            this.publish(operation);
          },
          prompt: (request) => this.prompt(operation, request, signal),
        });
        if (signal.aborted) {
          await connection.close();
          signal.throwIfAborted();
        }
        return connection;
      } finally {
        operation.answer?.(null);
        owner.removeListener("destroyed", destroyed);
        owner.removeListener("did-navigate", destroyed);
        this.operations.delete(owner.id);
        if (!owner.isDestroyed()) owner.send(IPC_CHANNELS.sshStateChanged, null);
      }
    };
  }

  respond(owner: Owner, input: SshPromptResponse): void {
    const operation = this.operations.get(owner.id);
    if (
      !operation ||
      operation.state.operationID !== input.operationID ||
      operation.state.prompt?.id !== input.promptID
    ) {
      throw new Error("SSH prompt is no longer available in this window");
    }
    operation.answer?.(input.value);
  }

  cancel(owner: Owner, operationID: string): void {
    const operation = this.operations.get(owner.id);
    if (!operation || operation.state.operationID !== operationID) return;
    operation.abort.abort(new Error("SSH connection canceled"));
  }

  private publish(operation: Operation): void {
    if (!operation.owner.isDestroyed()) {
      operation.owner.send(IPC_CHANNELS.sshStateChanged, structuredClone(operation.state));
    }
  }

  private prompt(
    operation: Operation,
    request: SshPrompt,
    signal: AbortSignal,
  ): Promise<string | null> {
    signal.throwIfAborted();
    if (operation.answer) throw new Error("An SSH authentication prompt is already pending");
    return new Promise((resolve) => {
      const finish = (value: string | null) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        operation.answer = undefined;
        operation.state.prompt = null;
        this.publish(operation);
        resolve(value);
      };
      const aborted = () => finish(null);
      const timer = setTimeout(aborted, 5 * 60_000);
      operation.answer = finish;
      operation.state.prompt = { id: randomUUID(), request };
      signal.addEventListener("abort", aborted, { once: true });
      this.publish(operation);
    });
  }
}

export const sshInteractions = new SshInteractions();
