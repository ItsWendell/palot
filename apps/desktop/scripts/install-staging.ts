import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

/** Own one staging directory; never sweep another installer's working files. */
export async function withInstallStaging<T>(
  installRoot: string,
  productName: string,
  install: (bundle: string, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Nightly installation interrupted."));
  // Defer cleanup until the operation settles, including any command still writing to staging.
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  let directory: string | undefined;
  try {
    directory = await mkdtemp(path.join(installRoot, `.${productName}.install-${process.pid}-`));
    controller.signal.throwIfAborted();
    const result = await install(path.join(directory, `${productName}.app`), controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
    }
  }
}
