import path from "node:path";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIRECTORIES = [path.join(APP_ROOT, "out"), path.join(APP_ROOT, "release")];

await Promise.all(
  OUTPUT_DIRECTORIES.map((directory) => rm(directory, { recursive: true, force: true })),
);
