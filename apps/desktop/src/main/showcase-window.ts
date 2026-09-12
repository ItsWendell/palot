import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, type Rectangle } from "electron";

export interface ShowcaseConfiguration {
  backgroundPath: string;
  layoutPath: string;
  zoomFactor: number;
  canvas: Rectangle;
  window: Rectangle;
}

export function resolveShowcaseConfiguration(
  env: NodeJS.ProcessEnv,
  workArea: Rectangle,
): ShowcaseConfiguration | undefined {
  if (env.PALOT_SHOWCASE !== "1") return undefined;
  const backgroundPath = env.PALOT_SHOWCASE_BACKGROUND;
  const layoutPath = env.PALOT_SHOWCASE_LAYOUT_PATH;
  if (!backgroundPath || !path.isAbsolute(backgroundPath)) {
    throw new Error("PALOT_SHOWCASE_BACKGROUND must be an absolute path");
  }
  if (!layoutPath || !path.isAbsolute(layoutPath)) {
    throw new Error("PALOT_SHOWCASE_LAYOUT_PATH must be an absolute path");
  }

  const targetWidth = Math.min(1_280, workArea.width);
  const targetHeight = Math.round((targetWidth * 9) / 16);
  const canvasHeight = Math.min(targetHeight, workArea.height);
  const canvasWidth = Math.round((canvasHeight * 16) / 9);
  if (canvasWidth < 1_048 || canvasHeight < 700) {
    throw new Error("The primary display is too small for the Palot showcase capture");
  }
  const canvas = {
    x: workArea.x + Math.round((workArea.width - canvasWidth) / 2),
    y: workArea.y + Math.round((workArea.height - canvasHeight) / 2),
    width: canvasWidth,
    height: canvasHeight,
  };
  const windowInset = 16;
  const window = {
    x: canvas.x + windowInset,
    y: canvas.y + windowInset,
    width: canvas.width - windowInset * 2,
    height: canvas.height - windowInset * 2,
  };
  return { backgroundPath, layoutPath, zoomFactor: 0.9, canvas, window };
}

export async function createShowcaseBackdrop(
  configuration: ShowcaseConfiguration,
): Promise<BrowserWindow> {
  const backdrop = new BrowserWindow({
    ...configuration.canvas,
    title: "Palot showcase backdrop",
    frame: false,
    show: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: "#07111d",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const background = await readFile(configuration.backgroundPath);
  const extension = path.extname(configuration.backgroundPath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
  const backgroundURL = `data:${mime};base64,${background.toString("base64")}`;
  const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#d9cee1}body{background-image:url(${JSON.stringify(backgroundURL)});background-size:cover;background-position:center}</style>`;
  await backdrop.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await writeFile(
    configuration.layoutPath,
    JSON.stringify({ canvas: configuration.canvas, window: configuration.window }, null, 2),
    { mode: 0o600 },
  );
  return backdrop;
}
