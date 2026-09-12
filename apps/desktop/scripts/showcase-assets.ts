import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface CaptureOptions {
  layoutPath: string;
  runRoot: string;
  outputDirectory: string;
}

interface LayoutFile {
  canvas: { x: number; y: number; width: number; height: number };
}

export async function captureShowcaseAssets(options: CaptureOptions): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Native Palot showcase capture currently requires macOS");
  }
  const layout = JSON.parse(await readFile(options.layoutPath, "utf8")) as LayoutFile;
  const source = path.join(options.runRoot, "showcase-native.png");
  const { x, y, width, height } = layout.canvas;
  await new Promise((resolve) => setTimeout(resolve, 500));
  await execFileAsync("/usr/sbin/screencapture", ["-x", `-R${x},${y},${width},${height}`, source]);
  await mkdir(options.outputDirectory, { recursive: true });

  await createVariant(source, path.join(options.outputDirectory, "palot-readme-cover.webp"), {
    width: 2_400,
    height: 1_350,
  });
  console.log(`Palot showcase assets: ${options.outputDirectory}`);
}

async function createVariant(
  source: string,
  output: string,
  size: { width: number; height: number; crop?: boolean },
): Promise<void> {
  const temporary = `${output}.png`;
  await copyFile(source, temporary);
  if (size.crop) {
    const ratio = size.width / size.height;
    const metadata = await imageSize(temporary);
    const sourceRatio = metadata.width / metadata.height;
    const cropWidth = sourceRatio > ratio ? Math.round(metadata.height * ratio) : metadata.width;
    const cropHeight = sourceRatio > ratio ? metadata.height : Math.round(metadata.width / ratio);
    await execFileAsync("sips", [
      "--cropToHeightWidth",
      String(cropHeight),
      String(cropWidth),
      temporary,
    ]);
  }
  await execFileAsync("sips", [
    "--resampleHeightWidth",
    String(size.height),
    String(size.width),
    temporary,
  ]);
  await execFileAsync("cwebp", ["-quiet", "-q", "88", temporary, "-o", output]);
  await rm(temporary, { force: true });
}

async function imageSize(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!width || !height) throw new Error(`Could not read image dimensions for ${file}`);
  return { width, height };
}
