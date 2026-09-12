import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function resolvedPackage(specifier: string, from: string) {
  // The coverage CLI runs on Bun, which honors the ESM parent argument (including import-only exports).
  const entry = fileURLToPath(import.meta.resolve(specifier, pathToFileURL(from).href));
  let directory = path.dirname(entry);
  while (true) {
    const manifest = path.join(directory, "package.json");
    try {
      const value = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (value.name === specifier.split("/").slice(0, 2).join("/") && value.version) {
        return { entry, manifest, version: value.version };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error(`Could not find package metadata for ${specifier} resolved to ${entry}.`);
    directory = parent;
  }
}

export function resolveCoveragePackages(from = fileURLToPath(import.meta.url)) {
  const client = resolvedPackage("@opencode/client", from);
  const protocol = resolvedPackage("@opencode/protocol/client", from);
  const clientProtocol = resolvedPackage("@opencode/protocol/client", client.entry);
  const schema = resolvedPackage("@opencode/schema", protocol.entry);
  const clientSchema = resolvedPackage("@opencode/schema", client.entry);
  const clientProtocolSchema = resolvedPackage("@opencode/schema", clientProtocol.entry);
  const packages = {
    resolvedClient: client,
    resolvedProtocol: protocol,
    resolvedClientProtocol: clientProtocol,
    resolvedSchema: schema,
    resolvedClientSchema: clientSchema,
    resolvedClientProtocolSchema: clientProtocolSchema,
  };
  return {
    versions: Object.fromEntries(
      Object.entries(packages).map(([name, value]) => [name, value.version]),
    ),
    paths: Object.fromEntries(
      Object.entries(packages).map(([name, value]) => [name, value.manifest]),
    ),
    declarations: path.join(path.dirname(client.entry), "generated/types.d.ts"),
    effectOpenApi: import.meta.resolve(
      "effect/unstable/httpapi",
      pathToFileURL(protocol.entry).href,
    ),
  };
}
