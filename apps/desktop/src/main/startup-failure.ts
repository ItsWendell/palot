export type ProcessFailureKind = "exception" | "rejection";

/**
 * Routes uncaught exceptions and unhandled rejections. Until the first main window has
 * loaded, a failure may mean Palot cannot start, so it goes to the recovery window. After
 * that the app is working: offering to remove all data over it would be wrong, so every
 * failure is logged instead.
 */
export function createProcessFailureHandler(options: {
  startupFinished(): boolean;
  recover(failure: unknown): void;
  log(message: string, failure: unknown): void;
}): (kind: ProcessFailureKind, failure: unknown) => void {
  return (kind, failure) => {
    if (!options.startupFinished()) {
      options.recover(failure);
      return;
    }
    options.log(
      kind === "exception"
        ? "Palot caught an uncaught exception"
        : "Palot caught an unhandled promise rejection",
      failure,
    );
  };
}
