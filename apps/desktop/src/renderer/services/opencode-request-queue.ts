/** Keep background reads bounded without making writes wait for slow Git operations. */
export function createOpenCodeReadQueue(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", abort);
        active += 1;
        resolve();
      };
      const abort = () => {
        const index = waiting.indexOf(start);
        if (index !== -1) waiting.splice(index, 1);
        reject(signal.reason);
      };
      if (active < limit) start();
      else {
        waiting.push(start);
        signal.addEventListener("abort", abort, { once: true });
      }
    });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      waiting.shift()?.();
    };
  };
}
