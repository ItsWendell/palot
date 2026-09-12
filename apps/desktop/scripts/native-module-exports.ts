import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Resolve the actual package exports under both Node module conditions. */
export async function verifyLiquidGlassExports(packageDirectory: string): Promise<void> {
  const { stdout } = await execFileAsync(
    "node",
    [
      "--input-type=module",
      "-e",
      `import { createRequire } from 'node:module';
     import { pathToFileURL } from 'node:url';
     const require = createRequire(pathToFileURL(process.argv[1]));
     const esm = (await import('electron-liquid-glass')).default;
     const cjs = require('electron-liquid-glass');
     for (const [kind, glass] of [['import', esm], ['require', cjs]]) {
       for (const method of ['addView', 'removeView', 'isGlassSupported', 'setAppearance']) {
         if (typeof glass?.[method] !== 'function') throw new Error(kind + ' lacks ' + method);
       }
     }
     console.log('Liquid Glass import and require exports verified');`,
      path.join(packageDirectory, "package.json"),
    ],
    { cwd: packageDirectory, timeout: 15_000, maxBuffer: 64 * 1_024 },
  );
  if (!stdout.includes("Liquid Glass import and require exports verified")) {
    throw new Error("Liquid Glass module verification did not complete.");
  }
}
