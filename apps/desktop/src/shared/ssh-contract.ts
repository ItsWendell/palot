/** SSH configuration only. Authentication answers and service credentials are never persisted. */
export interface SshConfig {
  target: string;
  port?: number;
  identityFile?: string;
}

export type SshPrompt =
  | { kind: "authentication"; text: string; confirm: boolean }
  | {
      kind: "setup";
      action: "install" | "start" | "replace";
      version: string;
      currentVersion?: string;
    };

export interface SshConnectionState {
  operationID: string;
  target: string;
  stage: string;
  prompt: { id: string; request: SshPrompt } | null;
}

export interface SshPromptResponse {
  operationID: string;
  promptID: string;
  value: string | null;
}
