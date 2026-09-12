import type { DesktopNotificationDeliveryStatus } from "../shared/opencode-contract";

const USER_NOTIFICATIONS_FRAMEWORK =
  "/System/Library/Frameworks/UserNotifications.framework/UserNotifications";
const SETTINGS_TIMEOUT_MS = 10_000;
const AUTHORIZATION_OPTIONS = 1 | 2 | 4;

type NotificationCenter = {
  getNotificationSettingsWithCompletionHandler$(callback: (settings: NativeSettings) => void): void;
  requestAuthorizationWithOptions$completionHandler$(
    options: number,
    callback: (granted: boolean, error: NativeError | null) => void,
  ): void;
};

type NativeSettings = {
  authorizationStatus(): number;
  alertSetting(): number;
  notificationCenterSetting(): number;
};

type NativeError = {
  localizedDescription(): { toString(): string };
};

type TypedBlock = <T>(signature: { returns: string; args: string[] }, callback: T) => T;

interface ObjcJsModule {
  NobjcLibrary: new (
    framework: string,
  ) => Record<string, Record<string, ((...args: never[]) => unknown) | undefined> | undefined>;
  RunLoop: { run(): () => void };
  typedBlock: TypedBlock;
}

let centerPromise: Promise<NotificationCenter> | null = null;
let runLoopUsers = 0;
let stopRunLoop: (() => void) | null = null;

function loadObjcJs(): Promise<ObjcJsModule> {
  const moduleName = "objc-js";
  return import(/* @vite-ignore */ moduleName) as Promise<ObjcJsModule>;
}

export async function macosNotificationDeliveryStatus(): Promise<DesktopNotificationDeliveryStatus> {
  const settings = await withNativeCallback<NativeSettings>(async (complete, typedBlock) => {
    const center = await notificationCenter();
    center.getNotificationSettingsWithCompletionHandler$(
      typedBlock({ returns: "v", args: ["@"] }, complete),
    );
  }, SETTINGS_TIMEOUT_MS);

  return {
    authorization: authorizationState(Number(settings.authorizationStatus())),
    delivery: deliveryState(
      Number(settings.alertSetting()),
      Number(settings.notificationCenterSetting()),
    ),
  };
}

export async function requestMacosNotificationPermission(): Promise<void> {
  // Authorization may wait for a human answer; only settings queries have a deadline.
  await withNativeCallback<void>(async (complete, typedBlock) => {
    const center = await notificationCenter();
    center.requestAuthorizationWithOptions$completionHandler$(
      AUTHORIZATION_OPTIONS,
      typedBlock({ returns: "v", args: ["B", "@"] }, (_granted, error) => {
        try {
          if (error) {
            throw new Error(error.localizedDescription().toString());
          }
          complete();
        } catch (error) {
          complete.reject(error);
        }
      }),
    );
  });
}

async function notificationCenter(): Promise<NotificationCenter> {
  centerPromise ??= loadObjcJs().then(({ NobjcLibrary }) => {
    const framework = new NobjcLibrary(USER_NOTIFICATIONS_FRAMEWORK);
    const currentNotificationCenter = framework.UNUserNotificationCenter?.currentNotificationCenter;
    if (!currentNotificationCenter) {
      throw new Error("macOS UserNotifications framework is unavailable");
    }
    return currentNotificationCenter() as NotificationCenter;
  });
  try {
    return await centerPromise;
  } catch (error) {
    centerPromise = null;
    throw error;
  }
}

async function withNativeCallback<T>(
  start: (
    complete: ((value: T) => void) & { reject(error: unknown): void },
    typedBlock: TypedBlock,
  ) => void | Promise<void>,
  timeoutMs?: number,
): Promise<T> {
  const { RunLoop, typedBlock } = await loadObjcJs();
  return new Promise<T>((resolve, reject) => {
    const releaseRunLoop = acquireRunLoop(RunLoop);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const cleanup = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      releaseRunLoop();
    };
    const finish = ((value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }) as ((value: T) => void) & { reject(error: unknown): void };
    finish.reject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    if (timeoutMs !== undefined) {
      timeout = setTimeout(
        () => finish.reject(new Error("macOS did not return notification settings")),
        timeoutMs,
      );
    }
    try {
      void Promise.resolve(start(finish, typedBlock)).catch(finish.reject);
    } catch (error) {
      finish.reject(error);
    }
  });
}

function acquireRunLoop(runLoop: ObjcJsModule["RunLoop"]): () => void {
  if (runLoopUsers === 0) stopRunLoop = runLoop.run();
  runLoopUsers += 1;
  return () => {
    runLoopUsers -= 1;
    if (runLoopUsers === 0) {
      stopRunLoop?.();
      stopRunLoop = null;
    }
  };
}

function authorizationState(status: number): DesktopNotificationDeliveryStatus["authorization"] {
  switch (status) {
    case 0:
      return "not-determined";
    case 1:
      return "denied";
    case 2:
      return "authorized";
    case 3:
      return "provisional";
    case 4:
      return "ephemeral";
    default:
      return "unavailable";
  }
}

function deliveryState(
  alertSetting: number,
  notificationCenterSetting: number,
): DesktopNotificationDeliveryStatus["delivery"] {
  if (alertSetting === 2) return "alerts";
  if (notificationCenterSetting === 2) return "notification-center";
  if (alertSetting === 1 && notificationCenterSetting === 1) return "off";
  return "unknown";
}
