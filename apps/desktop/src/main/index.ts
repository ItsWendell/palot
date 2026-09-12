/** Palot 2 Electron main entry. */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  nativeTheme,
  powerMonitor,
  screen,
  session,
  shell,
} from "electron";
import log from "electron-log/main";
import {
  APPEARANCE_STORED_ARGUMENT,
  effectiveAppearanceTreatment,
  REDUCED_TRANSPARENCY_ARGUMENT,
  serializeAppearancePreferences,
} from "../shared/appearance-contract";
import { resolveBuildIdentity } from "../shared/build-identity";
import { IPC_CHANNELS, type PalotOpenTarget } from "../shared/opencode-contract";
import { registerIpcHandlers } from "./ipc-handlers";
import { installLiquidGlass, nativeGlassOptions, resolveWindowChrome } from "./liquid-glass";
import { openCodeRuntime } from "./opencode-runtime";
import {
  createSessionWindowScope,
  type SessionWindowConnection,
  type SessionWindowScope,
} from "./opencode-native-scope";
import { closePalotDatabase } from "./database/client";
import { hydrateShellEnvironment } from "./shell-environment";
import { automationService } from "./automations/service";
import { desktopNavigation } from "./desktop-navigation";
import { desktopNotificationService } from "./notification-service";
import { appearanceService } from "./appearance-service";
import { destroyTray, installTray } from "./tray";
import { destroyOpenCodeAttentionIndex } from "./attention-index";
import { restoreWindowState, saveWindowState, trackWindowState } from "./window-state";
import { startupWindowPresentation } from "./window-startup";
import { allowedExternalUrl } from "./external-url-policy";
import {
  cleanupStagedAttachments,
  shutdownAttachmentStorage,
  inspectPickedFiles,
} from "./file-attachments";
import { registerWindowRole } from "./ipc-security";
import { initializeLogging } from "./logging";
import { installDenyAllPermissionPolicy } from "./electron-permissions";
import { showRecoveryWindow } from "./recovery-window";
import { completePendingPalotReset } from "./data-recovery";
import { createShowcaseBackdrop, resolveShowcaseConfiguration } from "./showcase-window";
import { installNativeContextMenu } from "./native-context-menu";
import { linuxDesktopDiagnostics } from "./linux-desktop";
import { DESKTOP_HELP, parseDesktopLaunch } from "./desktop-launch";
import { stat } from "node:fs/promises";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const isDevelopment = !app.isPackaged;
const diagnosticsRequested = process.argv.includes("--diagnostics");
const helpRequested = process.argv.includes("--help");
const rendererEntryUrl =
  isDevelopment && process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).href
    : pathToFileURL(path.join(currentDirectory, "../renderer/index.html")).href;
const developmentID = isDevelopment
  ? (process.env.PALOT_DEV_INSTANCE_ID ?? path.basename(path.resolve(app.getAppPath(), "../..")))
  : undefined;
const buildIdentity = resolveBuildIdentity({
  development: isDevelopment,
  configuredChannel: __PALOT_BUILD_CHANNEL__,
  developmentID,
});

if (isDevelopment) {
  app.commandLine.appendSwitch(
    "remote-debugging-port",
    process.env.PALOT_REMOTE_DEBUGGING_PORT ?? "9223",
  );
}
if (process.env.PALOT_E2E_USER_DATA) app.commandLine.appendSwitch("use-mock-keychain");

app.setName(buildIdentity.displayName);
app.setAppUserModelId(buildIdentity.appId);
if (process.platform === "linux") {
  app.setDesktopName(`${buildIdentity.appId}.desktop`);
  app.commandLine.appendSwitch("class", buildIdentity.appId);
}
const temporaryUserData =
  process.env.PALOT_E2E_USER_DATA ?? process.env.PALOT_RELEASE_SMOKE_USER_DATA;
if (temporaryUserData) {
  app.setPath("userData", temporaryUserData);
} else if (buildIdentity.channel !== "stable") {
  const userDataPath = path.join(app.getPath("appData"), buildIdentity.userDataName);
  app.setPath("userData", userDataPath);
}
if (!diagnosticsRequested && !helpRequested) completePendingPalotReset(app.getPath("userData"));
const logDirectory = process.env.PALOT_LOG_DIR;
initializeLogging(isDevelopment, logDirectory);
log.info("Palot diagnostics initialized", {
  channel: buildIdentity.channel,
  version: app.getVersion(),
  logFile: log.transports.file.getFile().path,
});

const menu: Electron.MenuItemConstructorOptions[] = [
  ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
  { role: "editMenu" },
  { role: "viewMenu" },
  { role: "windowMenu" },
];
let mainWindow: BrowserWindow | null = null;
const workspaceWindows = new Set<BrowserWindow>();
const windowTargets = new Map<BrowserWindow, PalotOpenTarget>();
const sessionWindowScopes = new WeakMap<BrowserWindow, SessionWindowScope>();
let startupFailureReported = false;
let quitting = false;

function reportStartupFailure(failure: unknown): void {
  if (startupFailureReported || quitting) return;
  startupFailureReported = true;
  log.error("Palot startup boundary caught a failure", failure);
  void app.whenReady().then(() => showRecoveryWindow(failure));
}

process.on("uncaughtException", reportStartupFailure);
process.on("unhandledRejection", reportStartupFailure);

async function createWindow(
  sessionID?: string,
  owner?: SessionWindowConnection,
): Promise<BrowserWindow> {
  const profileID = owner?.profileID;
  owner?.runtimeStatus();
  const isMac = process.platform === "darwin";
  const startupPresentation = startupWindowPresentation(process.env);
  const icon = resolveAppIcon();
  const appearance = appearanceService().preferences();
  const hasStoredAppearance = appearanceService().hasStoredPreferences();
  const reducedTransparency = nativeTheme.prefersReducedTransparency;
  appearanceService().applyMode(appearance);
  const scheme =
    appearance.source === "system" && appearance.omarchyTheme
      ? appearance.omarchyTheme.mode
      : appearance.source === "system" || appearance.mode === "system"
        ? nativeTheme.shouldUseDarkColors
          ? "dark"
          : "light"
        : appearance.mode;
  const treatment = effectiveAppearanceTreatment(appearance, scheme);
  const chrome = await resolveWindowChrome(
    appearance.windowMaterial,
    reducedTransparency,
    treatment.native.backdrop,
  );
  const glassOptions = nativeGlassOptions(appearance, scheme);
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  const showcase = resolveShowcaseConfiguration(process.env, primaryWorkArea);
  const showcaseBackdrop = showcase ? await createShowcaseBackdrop(showcase) : null;
  const windowState = showcase
    ? { bounds: showcase.window, maximized: false }
    : restoreWindowState(
        screen.getAllDisplays().map((display) => display.workArea),
        primaryWorkArea,
      );
  const window = new BrowserWindow({
    title: buildIdentity.displayName,
    ...(windowState.bounds ?? { width: 1_440, height: 920 }),
    // Tiling compositors can allocate less than 640px. A larger native minimum
    // makes Chromium render a surface wider than the compositor's visible tile.
    minWidth: showcase || process.platform === "linux" ? 0 : 640,
    minHeight: showcase || process.platform === "linux" ? 0 : 480,
    // Linux compositors may suppress server-side decorations. Own a close control.
    ...(process.platform === "linux" ? { frame: false } : {}),
    show: false,
    autoHideMenuBar: process.platform === "linux",
    focusable: process.env.PALOT_E2E_INACTIVE !== "1",
    backgroundColor: appearanceService().backgroundColor(appearance, scheme, chrome.tier),
    ...chrome.options,
    ...(process.platform === "linux" &&
    appearance.linuxBackgroundOpacity < 100 &&
    !reducedTransparency
      ? { transparent: true }
      : {}),
    icon: isMac ? undefined : icon,
    webPreferences: {
      preload: path.join(currentDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      scrollBounce: isMac,
      spellcheck: true,
      additionalArguments: [
        `--palot-chrome-tier=${chrome.tier}`,
        serializeAppearancePreferences(appearance),
        ...(hasStoredAppearance ? [APPEARANCE_STORED_ARGUMENT] : []),
        ...(reducedTransparency ? [REDUCED_TRANSPARENCY_ARGUMENT] : []),
      ],
    },
  });
  workspaceWindows.add(window);
  if (owner) sessionWindowScopes.set(window, createSessionWindowScope(owner, openCodeRuntime));
  if (!mainWindow) mainWindow = window;
  if (sessionID)
    windowTargets.set(window, { type: "session", sessionID, ...(profileID ? { profileID } : {}) });
  window.on("focus", () => openCodeRuntime.recoverEventStream("focus"));
  let rendererLoaded = false;
  registerWindowRole(window, "main");
  installNativeContextMenu(window);
  if (showcase) {
    window.webContents.once("did-finish-load", () => {
      window.webContents.setZoomFactor(showcase.zoomFactor);
    });
  }
  if (!showcase) trackWindowState(window);
  if (windowState.maximized) window.maximize();

  // Session windows are shown by their caller only after the owner is revalidated.
  if (!sessionID && startupPresentation !== "hidden") {
    window.once("ready-to-show", () => {
      if (showcaseBackdrop && !showcaseBackdrop.isDestroyed()) showcaseBackdrop.showInactive();
      if (showcase) {
        // Keep the native capture scene above unrelated desktop windows.
        window.setAlwaysOnTop(true, "pop-up-menu");
        window.show();
        window.focus();
      } else if (startupPresentation === "inactive") window.showInactive();
      else window.show();
    });
  }
  window.on("page-title-updated", (event, title) => {
    event.preventDefault();
    window.setTitle(
      title && title !== "Palot"
        ? `${title} — ${buildIdentity.displayName}`
        : buildIdentity.displayName,
    );
  });
  window.on("closed", () => {
    if (showcaseBackdrop && !showcaseBackdrop.isDestroyed()) showcaseBackdrop.destroy();
    workspaceWindows.delete(window);
    windowTargets.delete(window);
    if (mainWindow === window) mainWindow = workspaceWindows.values().next().value ?? null;
  });
  if (isDevelopment && process.env.PALOT_DEVTOOLS === "1") {
    window.webContents.once("did-finish-load", () => {
      window.webContents.openDevTools({ mode: "detach" });
    });
  }

  if (chrome.tier === "liquid-glass") {
    window.webContents.once("did-finish-load", () => {
      void installLiquidGlass(window, glassOptions).then((tier) => {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.chromeTierChanged, tier);
      });
    });
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = allowedExternalUrl(url, isDevelopment);
    if (externalUrl) void shell.openExternal(externalUrl);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (url === currentUrl) return;
    event.preventDefault();
    const externalUrl = allowedExternalUrl(url, isDevelopment);
    if (externalUrl) void shell.openExternal(externalUrl);
  });
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    reportStartupFailure(new Error(`Palot preload failed at ${preloadPath}: ${error.message}`));
  });
  window.webContents.once("did-finish-load", () => {
    rendererLoaded = true;
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (mainWindow === window) mainWindow = null;
    reportStartupFailure(
      new Error(
        `Palot renderer stopped ${rendererLoaded ? "after launch" : "during startup"}: ${details.reason}`,
      ),
    );
  });

  try {
    const entry = new URL(rendererEntryUrl);
    // Route before the first render: the index route restores the last task and
    // can otherwise win a race against the asynchronous takeOpenTarget IPC.
    if (sessionID)
      entry.hash = `/sessions/${encodeURIComponent(sessionID)}${profileID ? `?profileID=${encodeURIComponent(profileID)}` : ""}`;
    owner?.runtimeStatus();
    await window.loadURL(entry.href);
    owner?.runtimeStatus();
  } catch (error) {
    // A rejected secondary load must not leave a hidden window keeping the app alive.
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
  return window;
}

function resolveAppIcon(fileName = "icon.png"): Electron.NativeImage {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icons", buildIdentity.iconVariant, fileName)
    : path.join(currentDirectory, "../../resources/icons", buildIdentity.iconVariant, fileName);
  return nativeImage.createFromPath(iconPath);
}

async function showMainWindow(): Promise<BrowserWindow> {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : await createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}

const hasSingleInstanceLock =
  !diagnosticsRequested && !helpRequested && app.requestSingleInstanceLock();
if (helpRequested) {
  console.log(DESKTOP_HELP);
  app.quit();
} else if (diagnosticsRequested) {
  void app.whenReady().then(async () => {
    console.log(
      JSON.stringify(
        {
          ...(await linuxDesktopDiagnostics()),
          identity: buildIdentity,
          versions: process.versions,
          gpu: app.getGPUFeatureStatus(),
          ozonePlatform: app.commandLine.getSwitchValue("ozone-platform") || "auto",
          displays: screen
            .getAllDisplays()
            .map(({ size, scaleFactor, workArea }) => ({ size, scaleFactor, workArea })),
        },
        null,
        2,
      ),
    );
    app.quit();
  });
} else if (!hasSingleInstanceLock) {
  app.quit();
} else {
  const handleLaunch = async (args: string[], cwd: string) => {
    const target = parseDesktopLaunch(args, cwd) ?? { type: "open" as const };
    if (target.type === "project" && !(await stat(target.directory)).isDirectory())
      throw new Error("Project path must be a directory");
    if (target.type === "project" && target.attachmentPaths?.length) {
      const inspected = await inspectPickedFiles(target.attachmentPaths);
      if (inspected.errors.length) throw new Error(inspected.errors.join("\n"));
      desktopNavigation.request({
        type: "project",
        directory: target.directory,
        files: inspected.files,
      });
    } else desktopNavigation.request(target);
  };
  app.on("second-instance", (_event, args, cwd) => {
    void handleLaunch(args, cwd).catch((error) => log.warn("Desktop launch failed", error));
  });

  void app
    .whenReady()
    .then(async () => {
      hydrateShellEnvironment();
      await appearanceService().initializeDesktopAppearance();
      powerMonitor.on("resume", () => openCodeRuntime.recoverEventStream("resume"));
      installDenyAllPermissionPolicy(session.defaultSession);
      await cleanupStagedAttachments();
      app.setAboutPanelOptions({
        applicationName: buildIdentity.displayName,
        applicationVersion: app.getVersion(),
        version: buildIdentity.label ?? undefined,
      });
      if (process.platform === "darwin" && !app.isPackaged) {
        app.dock?.setIcon(resolveAppIcon("dock.png"));
      }
      Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
      desktopNotificationService().configure(buildIdentity.appId);
      registerIpcHandlers({
        expectedWindow: (event) => {
          const window = BrowserWindow.fromWebContents(event.sender);
          return window && workspaceWindows.has(window) ? window : null;
        },
        sessionWindowScope: (window) => sessionWindowScopes.get(window),
        openSessionWindow: async (sessionID, owner) => {
          const window = await createWindow(sessionID, owner);
          if (process.env.PALOT_E2E_INACTIVE === "1") window.showInactive();
          else {
            window.show();
            window.focus();
          }
        },
        takeWindowTarget: (window) => {
          const target = windowTargets.get(window);
          windowTargets.delete(window);
          return target ?? (window === mainWindow ? desktopNavigation.take() : null);
        },
        expectedUrl: rendererEntryUrl,
        expectedRole: "main",
        onStartupFailure: reportStartupFailure,
      });
      appearanceService().start();
      const initialTarget = parseDesktopLaunch(process.argv, process.cwd());
      if (initialTarget) await handleLaunch(process.argv, process.cwd());
      desktopNavigation.setOpenTarget(async (target) => {
        const window = await showMainWindow();
        const send = () => {
          if (!window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.openTargetRequested, target);
          }
        };
        if (window.webContents.isLoading()) window.webContents.once("did-finish-load", send);
        else send();
      });
      desktopNotificationService().start();
      await installTray({
        currentDirectory,
        displayName: buildIdentity.displayName,
        appID: buildIdentity.appId,
        iconVariant: buildIdentity.iconVariant,
      });
      automationService().setOpenTarget(async (target) => {
        const window = await showMainWindow();
        const send = () => {
          if (!window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.automationNotificationOpened, target);
          }
        };
        if (window.webContents.isLoading()) window.webContents.once("did-finish-load", send);
        else send();
      });
      await automationService().start();
      await createWindow();
      app.on("activate", () => {
        void showMainWindow();
      });
    })
    .catch(reportStartupFailure);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  let shutdownStarted = false;
  // User-local Linux upgrades request the same orderly teardown as File → Quit.
  if (process.platform === "linux") process.on("SIGTERM", () => app.quit());
  app.on("before-quit", (event) => {
    if (shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    quitting = true;
    if (mainWindow && !mainWindow.isDestroyed() && process.env.PALOT_SHOWCASE !== "1") {
      saveWindowState(mainWindow);
    }
    desktopNotificationService().shutdown();
    appearanceService().shutdown();
    const trayShutdown = destroyTray();
    void automationService()
      .shutdown()
      .finally(async () => {
        await trayShutdown;
        destroyOpenCodeAttentionIndex();
        await openCodeRuntime.shutdown();
        closePalotDatabase();
        await shutdownAttachmentStorage();
        app.quit();
      });
  });
}
