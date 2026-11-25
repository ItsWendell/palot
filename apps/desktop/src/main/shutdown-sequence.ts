export interface ShutdownStep {
  name: string;
  run(): unknown;
}

/**
 * Runs teardown steps in order. A step that throws or rejects is logged and the next one
 * still runs; once the deadline passes no further step starts and the result is
 * "deadline", so the caller can always go on to quit.
 */
export async function runShutdownSequence(
  steps: readonly ShutdownStep[],
  options: {
    deadlineMs: number;
    log(message: string, error?: unknown): void;
  },
): Promise<"settled" | "deadline"> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve("deadline");
    }, options.deadlineMs);
  });
  const sequence = (async () => {
    for (const step of steps) {
      if (expired) break;
      try {
        await step.run();
      } catch (error) {
        options.log(`Shutdown step failed: ${step.name}`, error);
      }
    }
    return "settled" as const;
  })();
  const result = await Promise.race([sequence, deadline]);
  clearTimeout(timer);
  if (result === "deadline")
    options.log(`Shutdown did not finish within ${options.deadlineMs} ms; quitting anyway`);
  return result;
}
