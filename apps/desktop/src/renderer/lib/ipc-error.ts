import { actionableErrorMessage } from "../../shared";

/** A main-process error as people should read it, without Electron's IPC wrapper. */
export function ipcErrorMessage(error: unknown, fallback: string): string {
  return actionableErrorMessage(error, fallback).replace(
    /^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/,
    "",
  );
}
