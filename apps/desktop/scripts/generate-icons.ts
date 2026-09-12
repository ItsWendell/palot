/** Generates channel-specific desktop, Dock, tray, and favicon assets from one mark. */

import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { PALOT_BUILD_CHANNELS, type PalotBuildChannel } from "../src/shared/build-identity";

const runFile = promisify(execFile);
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICON_ROOT = path.join(APP_ROOT, "resources/icons");
const MARK_SOURCE = path.join(ICON_ROOT, "source/mark.svg");
const BACKGROUND_ROOT = path.join(ICON_ROOT, "source/backgrounds");
const RENDERER_FAVICON = path.join(APP_ROOT, "src/renderer/favicon.svg");
const CHECK = process.argv.includes("--check");
const WINDOWS_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
const LINUX_ICON_SIZES = [16, 32, 48, 64, 128, 256, 512] as const;
const RASTER_CHANNELS = ["beta", "nightly", "dev"] as const;

type RasterChannel = (typeof RASTER_CHANNELS)[number];

interface ChannelStyle {
  backgroundStart: string;
  backgroundEnd: string;
  mark: string;
  source?: RasterChannel;
}

const CHANNEL_STYLES: Record<PalotBuildChannel, ChannelStyle> = {
  stable: {
    backgroundStart: "#11151c",
    backgroundEnd: "#02050a",
    mark: "#fffdf9",
  },
  beta: {
    backgroundStart: "#f7f7f5",
    backgroundEnd: "#e9ebee",
    mark: "#11131a",
    source: "beta",
  },
  nightly: {
    backgroundStart: "#03091c",
    backgroundEnd: "#071647",
    mark: "#fffdf9",
    source: "nightly",
  },
  dev: {
    backgroundStart: "#0963ca",
    backgroundEnd: "#06449f",
    mark: "#fffdf9",
    source: "dev",
  },
};

export function encodePngIco(images: ReadonlyArray<{ size: number; contents: Buffer }>): Buffer {
  const headerSize = 6;
  const entrySize = 16;
  const header = Buffer.alloc(headerSize + entrySize * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let imageOffset = header.length;
  for (const [index, image] of images.entries()) {
    const offset = headerSize + index * entrySize;
    const encodedSize = image.size === 256 ? 0 : image.size;
    header.writeUInt8(encodedSize, offset);
    header.writeUInt8(encodedSize, offset + 1);
    header.writeUInt8(0, offset + 2);
    header.writeUInt8(0, offset + 3);
    header.writeUInt16LE(1, offset + 4);
    header.writeUInt16LE(32, offset + 6);
    header.writeUInt32LE(image.contents.length, offset + 8);
    header.writeUInt32LE(imageOffset, offset + 12);
    imageOffset += image.contents.length;
  }

  return Buffer.concat([header, ...images.map((image) => image.contents)]);
}

export function renderChannelSvg(
  channel: PalotBuildChannel,
  markBody: string,
  kind: "mac" | "universal",
  backgroundHref?: string,
): string {
  const style = CHANNEL_STYLES[channel];
  const frame =
    kind === "mac"
      ? { x: 100, y: 100, size: 824, radius: 185 }
      : { x: 48, y: 48, size: 928, radius: 208 };
  const mark = markBody.replaceAll("currentColor", style.mark);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${style.backgroundStart}" />
      <stop offset="1" stop-color="${style.backgroundEnd}" />
    </linearGradient>
    <radialGradient id="stable-horizon" cx="50%" cy="18%" r="76%">
      <stop offset="0" stop-color="#fff6ef" />
      <stop offset="0.28" stop-color="#f0c6ef" />
      <stop offset="0.58" stop-color="#6fd6ff" />
      <stop offset="1" stop-color="#3f35e6" />
    </radialGradient>
    <clipPath id="body-clip">
      <rect x="${frame.x}" y="${frame.y}" width="${frame.size}" height="${frame.size}" rx="${frame.radius}" />
    </clipPath>
    <filter id="body-shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="24" flood-color="#000" flood-opacity="0.32" stdDeviation="28" />
    </filter>
    <filter id="mark-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="8" flood-color="#000" flood-opacity="0.24" stdDeviation="8" />
    </filter>
  </defs>
  <rect x="${frame.x}" y="${frame.y}" width="${frame.size}" height="${frame.size}" rx="${frame.radius}" fill="url(#background)" filter="url(#body-shadow)" />
  <g clip-path="url(#body-clip)">
    ${backgroundHref ? `<image href="${backgroundHref}" x="${frame.x}" y="${frame.y}" width="${frame.size}" height="${frame.size}" preserveAspectRatio="xMidYMid slice" />` : `<rect x="${frame.x}" y="${frame.y}" width="${frame.size}" height="${frame.size}" fill="url(#background)" /><ellipse cx="512" cy="${frame.y + frame.size + 56}" rx="${frame.size * 0.8}" ry="${frame.size * 0.24}" fill="url(#stable-horizon)" />`}
    <g transform="translate(216 260) scale(8.1)" filter="url(#mark-shadow)">${mark}</g>
    <rect x="${frame.x + 2}" y="${frame.y + 2}" width="${frame.size - 4}" height="${frame.size - 4}" rx="${frame.radius - 2}" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="4" />
  </g>
</svg>`;
}

function renderPng(svg: string, size: number): Buffer {
  return Buffer.from(
    new Resvg(svg, {
      fitTo: { mode: "width", value: size },
    })
      .render()
      .asPng(),
  );
}

function svgBody(source: string): string {
  const start = source.indexOf(">");
  const end = source.lastIndexOf("</svg>");
  if (start === -1 || end === -1 || end <= start)
    throw new Error(`Invalid SVG source: ${MARK_SOURCE}`);
  return source.slice(start + 1, end).trim();
}

function traySvg(markBody: string, color = "#000"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${markBody.replaceAll("currentColor", color)}</svg>`;
}

function faviconSvg(markBody: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0b1018" />
  <g transform="translate(5 4) scale(0.84)">${markBody.replaceAll("currentColor", "#fffdf9")}</g>
</svg>`;
}

async function createIcns(svg: string, root: string, channel: PalotBuildChannel): Promise<Buffer> {
  const iconset = path.join(root, `${channel}.iconset`);
  const output = path.join(root, `${channel}.icns`);
  await mkdir(iconset, { recursive: true });
  const renditions = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ] as const;
  await Promise.all(
    renditions.map(([size, name]) => writeFile(path.join(iconset, name), renderPng(svg, size))),
  );
  await runFile("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", output]);
  return readFile(output);
}

async function generatedOutputs(
  markBody: string,
  backgroundData: ReadonlyMap<RasterChannel, string>,
): Promise<Map<string, Buffer>> {
  const outputs = new Map<string, Buffer>();
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "palot-icons-"));
  try {
    for (const channel of PALOT_BUILD_CHANNELS) {
      const source = CHANNEL_STYLES[channel].source;
      const sourceHref = source ? `../source/backgrounds/${source}.png` : undefined;
      const renderHref = source ? backgroundData.get(source) : undefined;
      if (source && !renderHref) throw new Error(`Missing generated background for ${source}.`);

      const universalSource = renderChannelSvg(channel, markBody, "universal", sourceHref);
      const macSource = renderChannelSvg(channel, markBody, "mac", sourceHref);
      const universal = renderChannelSvg(channel, markBody, "universal", renderHref);
      const mac = renderChannelSvg(channel, markBody, "mac", renderHref);
      const directory = path.join(ICON_ROOT, channel);
      outputs.set(path.join(directory, "icon.svg"), Buffer.from(universalSource));
      outputs.set(path.join(directory, "mac.svg"), Buffer.from(macSource));
      outputs.set(path.join(directory, "icon.png"), renderPng(universal, 1024));
      outputs.set(path.join(directory, "mac.png"), renderPng(mac, 1024));
      outputs.set(path.join(directory, "dock.png"), renderPng(mac, 256));
      outputs.set(path.join(directory, "favicon.png"), renderPng(universal, 32));

      const windows = WINDOWS_ICON_SIZES.map((size) => ({
        size,
        contents: renderPng(universal, size),
      }));
      outputs.set(path.join(directory, "icon.ico"), encodePngIco(windows));
      for (const size of LINUX_ICON_SIZES) {
        outputs.set(path.join(directory, `${size}x${size}.png`), renderPng(universal, size));
      }
      if (process.platform === "darwin") {
        outputs.set(
          path.join(directory, "icon.icns"),
          await createIcns(mac, temporaryRoot, channel),
        );
      }
    }

    const tray = traySvg(markBody);
    outputs.set(path.join(ICON_ROOT, "tray/trayTemplate.svg"), Buffer.from(tray));
    outputs.set(path.join(ICON_ROOT, "tray/trayTemplate.png"), renderPng(tray, 18));
    outputs.set(path.join(ICON_ROOT, "tray/trayTemplate@2x.png"), renderPng(tray, 36));
    // Linux tray hosts do not apply macOS template tinting. Supply both panel contrasts.
    const linuxTray = traySvg(`<g transform="translate(-4.5 1)">${markBody}</g>`, "#dedede");
    outputs.set(path.join(ICON_ROOT, "tray/trayLinux.svg"), Buffer.from(linuxTray));
    outputs.set(path.join(ICON_ROOT, "tray/trayLinux.png"), renderPng(linuxTray, 24));
    outputs.set(path.join(ICON_ROOT, "tray/trayLinux@2x.png"), renderPng(linuxTray, 48));
    const linuxLightTray = traySvg(`<g transform="translate(-4.5 1)">${markBody}</g>`, "#242424");
    outputs.set(path.join(ICON_ROOT, "tray/trayLinuxLight.svg"), Buffer.from(linuxLightTray));
    outputs.set(path.join(ICON_ROOT, "tray/trayLinuxLight.png"), renderPng(linuxLightTray, 24));
    outputs.set(path.join(ICON_ROOT, "tray/trayLinuxLight@2x.png"), renderPng(linuxLightTray, 48));
    outputs.set(RENDERER_FAVICON, Buffer.from(faviconSvg(markBody)));
    return outputs;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomic(file: string, contents: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents);
  await rename(temporary, file);
}

async function main(): Promise<void> {
  const markBody = svgBody(await readFile(MARK_SOURCE, "utf8"));
  const backgroundData = new Map<RasterChannel, string>();
  await Promise.all(
    RASTER_CHANNELS.map(async (channel) => {
      const contents = await readFile(path.join(BACKGROUND_ROOT, `${channel}.png`));
      backgroundData.set(channel, `data:image/png;base64,${contents.toString("base64")}`);
    }),
  );
  const outputs = await generatedOutputs(markBody, backgroundData);
  const stale: string[] = [];

  for (const [file, expected] of outputs) {
    const current = (await exists(file)) ? await readFile(file) : null;
    if (current?.equals(expected)) continue;
    if (CHECK) stale.push(path.relative(APP_ROOT, file));
    else await writeAtomic(file, expected);
  }

  if (stale.length > 0) {
    throw new Error(
      `Generated icon assets are stale:\n${stale.map((file) => `- ${file}`).join("\n")}`,
    );
  }
  console.log(CHECK ? "Icon assets are current." : `Generated ${outputs.size} icon assets.`);
}

if (import.meta.main) await main();
