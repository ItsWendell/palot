import { spawn } from "node:child_process";
import { chmod, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { CDPSession, Page } from "@playwright/test";

export const VIDEO_LIMITS = {
  frames: 18_000,
  bytes: 512 * 1024 * 1024,
  frameBytes: 16 * 1024 * 1024,
  pendingFrames: 8,
  durationMs: 10 * 60_000,
} as const;

export interface VideoReport {
  mode: "cdp-screencast";
  path: string;
  frames: number;
  durationSeconds: number;
  bytes: number;
  sourceBytes: number;
  droppedFrames: 0;
  outOfOrderFrames: number;
  dimensions: { width: number; height: number };
  outputFps: 60;
  limitation: string;
}

interface Frame {
  file: string;
  timestamp: number;
  receivedAtMs?: number;
  metadata?: { timestamp?: number; deviceWidth: number; deviceHeight: number };
}

/** CDP supplies visual updates, not presented frames. Preserve their spacing. */
export function videoTimeline(frames: readonly Frame[], stoppedAt: number) {
  if (!frames.length) throw new Error("Video capture received no renderer frames");
  for (const frame of frames) {
    if (!/^frame-\d+\.jpg$/.test(frame.file) || !Number.isFinite(frame.timestamp)) {
      throw new Error("Invalid video frame metadata");
    }
  }
  // JPEG encoding can finish out of order. Keep the raw receipt order untouched;
  // stable sort retains every update (including ties) in the offline timeline.
  const ordered = [...frames].sort((a, b) => a.timestamp - b.timestamp);
  const first = ordered[0]!;
  if (!Number.isFinite(stoppedAt) || stoppedAt <= ordered.at(-1)!.timestamp) {
    throw new Error("Video stop timestamp must follow the final frame");
  }
  const lines = ["ffconcat version 1.0"];
  for (const [index, frame] of ordered.entries()) {
    const duration = (ordered[index + 1]?.timestamp ?? stoppedAt) - frame.timestamp;
    // Image demuxers otherwise quantize concat durations to their default 25 Hz.
    lines.push(
      `file '${frame.file}'`,
      "option framerate 1000000",
      `duration ${duration.toFixed(6)}`,
    );
  }
  lines.push(`file '${ordered.at(-1)!.file}'`, "option framerate 1000000");
  return { concat: `${lines.join("\n")}\n`, durationSeconds: stoppedAt - first.timestamp };
}

function abortError() {
  return new Error("Video recording cancelled");
}

/** No shell, process groups, or detached children: kill only this ffmpeg. */
function ffmpeg(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-nostdin", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let failure: Error | undefined;
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-64 * 1024);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const cancel = (error: Error) => {
      failure ??= error;
      child.kill("SIGKILL");
    };
    const abort = () => cancel(abortError());
    const timer = setTimeout(() => cancel(new Error("ffmpeg timed out")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.on("error", (error) => {
      failure ??= new Error(`Cannot run ffmpeg: ${error.message}`);
    });
    // close, unlike exit, also waits for the owned child's stdio to close.
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`ffmpeg failed (${code}): ${output}`));
      else resolve(output);
    });
  });
}

/** Call only for --video, before building or launching the isolated app. */
export async function assertVideoPrerequisites(): Promise<void> {
  const encoders = await ffmpeg(["-encoders"], 10_000);
  if (!/\blibx264\b/.test(encoders)) {
    throw new Error("--video requires an installed ffmpeg with the libx264 encoder");
  }
}

async function cdpCall<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Video CDP operation timed out")), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function startVideoCapture(
  page: Page,
  runRoot: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ stop(): Promise<VideoReport> }> {
  const { signal } = options;
  if (signal?.aborted) throw abortError();
  const directory = join(runRoot, "video-frames");
  const output = join(runRoot, "video.mp4");
  // Refuse reuse: frames must belong exclusively to this recording.
  await mkdir(directory, { mode: 0o700 });
  const session: CDPSession = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  const pending = new Set<Promise<void>>();
  let sourceBytes = 0;
  let dimensions = { width: 0, height: 0 };
  let earliestTimestamp = Infinity;
  let latestTimestamp = -Infinity;
  let sourceClockOrigin = -Infinity;
  let outOfOrderFrames = 0;
  let stopped = false;
  let ownsOutput = false;
  let failure: Error | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let stopPromise: Promise<VideoReport> | undefined;

  function fail(error: unknown) {
    failure ??= error instanceof Error ? error : new Error(String(error));
    // Start cleanup immediately, but leave the rejection observable through stop().
    void stop().catch(() => {});
  }

  function onFrame(event: {
    data: string;
    sessionId: number;
    metadata: { timestamp?: number; deviceWidth: number; deviceHeight: number };
  }) {
    if (stopped) return;
    let write: Promise<void> = Promise.resolve();
    try {
      const timestamp = event.metadata.timestamp;
      if (timestamp === undefined || !Number.isFinite(timestamp)) {
        throw new Error("Video frame is missing a CDP timestamp");
      }
      if (pending.size >= VIDEO_LIMITS.pendingFrames)
        throw new Error("Video write queue limit exceeded");
      if (frames.length >= VIDEO_LIMITS.frames) throw new Error("Video frame count limit exceeded");
      if (event.data.length > Math.ceil(VIDEO_LIMITS.frameBytes / 3) * 4) {
        throw new Error("Video individual frame byte limit exceeded");
      }
      const data = Buffer.from(event.data, "base64");
      if (data.length > VIDEO_LIMITS.frameBytes)
        throw new Error("Video individual frame byte limit exceeded");
      if (sourceBytes + data.length > VIDEO_LIMITS.bytes)
        throw new Error("Video byte limit exceeded");
      const earliest = Math.min(earliestTimestamp, timestamp);
      const latest = Math.max(latestTimestamp, timestamp);
      if (latest - earliest > VIDEO_LIMITS.durationMs / 1000) {
        throw new Error("Video duration limit exceeded");
      }
      if (!frames.length) {
        const { deviceWidth: width, deviceHeight: height } = event.metadata;
        if (!(width > 0 && height > 0 && Number.isFinite(width + height))) {
          throw new Error("Invalid video frame dimensions");
        }
        const ratio = Math.min(1, 1920 / width, 1080 / height);
        dimensions = {
          width: Math.max(2, Math.floor((width * ratio) / 2) * 2),
          height: Math.max(2, Math.floor((height * ratio) / 2) * 2),
        };
      }
      const receivedAtMs = performance.now();
      if (timestamp < latestTimestamp) outOfOrderFrames++;
      earliestTimestamp = earliest;
      latestTimestamp = latest;
      // Anchor the source clock to monotonic receipt time using the least-delayed
      // sample. A late older JPEG must not move that clock or add its delivery lag
      // to the recording. The first timeline timestamp is independently its min.
      sourceClockOrigin = Math.max(sourceClockOrigin, timestamp - receivedAtMs / 1000);
      const file = `frame-${String(frames.length).padStart(6, "0")}.jpg`;
      frames.push({ file, timestamp, receivedAtMs, metadata: { ...event.metadata } });
      sourceBytes += data.length;
      write = writeFile(join(directory, file), data, { mode: 0o600 });
    } catch (error) {
      failure ??= error instanceof Error ? error : new Error(String(error));
    }
    // ACK after queuing the write, not after disk IO. Both operations are handled.
    const ack = cdpCall(session.send("Page.screencastFrameAck", { sessionId: event.sessionId }));
    const work = Promise.allSettled([write, ack]).then((results) => {
      pending.delete(work);
      for (const result of results) if (result.status === "rejected") fail(result.reason);
    });
    pending.add(work);
    if (failure) fail(failure);
  }

  function stop(): Promise<VideoReport> {
    if (stopPromise) return stopPromise;
    stopped = true;
    const stoppedAtMs = performance.now();
    clearTimeout(deadline);
    session.off("Page.screencastFrame", onFrame);
    stopPromise = (async (): Promise<VideoReport> => {
      try {
        try {
          await cdpCall(session.send("Page.stopScreencast"));
        } catch (error) {
          failure ??= error instanceof Error ? error : new Error(String(error));
        }
        await Promise.all(pending);
        try {
          await cdpCall(session.detach());
        } catch (error) {
          failure ??= error instanceof Error ? error : new Error(String(error));
        }
        await writeFile(join(directory, "frames.json"), JSON.stringify(frames), { mode: 0o600 });
        if (failure) throw failure;
        if (signal?.aborted) throw abortError();
        const stoppedAt = frames.length
          ? Math.max(sourceClockOrigin + stoppedAtMs / 1000, latestTimestamp + 1 / 60)
          : 0;
        const timeline = videoTimeline(frames, stoppedAt);
        if (timeline.durationSeconds > VIDEO_LIMITS.durationMs / 1000) {
          throw new Error("Video duration limit exceeded");
        }
        await writeFile(join(directory, "timeline.ffconcat"), timeline.concat, { mode: 0o600 });
        await writeFile(output, "", { mode: 0o600, flag: "wx" });
        ownsOutput = true;
        const { width, height } = dimensions;
        await ffmpeg(
          [
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            join(directory, "timeline.ffconcat"),
            "-an",
            "-vf",
            `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:out_range=tv,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,fps=60`,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-color_range",
            "tv",
            "-r",
            "60",
            "-t",
            String(timeline.durationSeconds),
            "-movflags",
            "+faststart",
            output,
          ],
          120_000,
          signal,
        );
        if (signal?.aborted) throw abortError();
        await chmod(output, 0o600);
        const { size } = await stat(output);
        if (!size) throw new Error("ffmpeg produced an empty video");
        return {
          mode: "cdp-screencast",
          path: output,
          frames: frames.length,
          durationSeconds: timeline.durationSeconds,
          bytes: size,
          sourceBytes,
          droppedFrames: 0,
          outOfOrderFrames,
          dimensions,
          outputFps: 60,
          limitation:
            "Renderer-only CDP visual updates, not presented FPS; 60 fps resampling may repeat/coalesce updates. No audio. Raw receipt metadata is retained; offline frames are source-timestamp sorted. Timing starts at the earliest source frame; the final frame is held until monotonic stop, anchored to the least-delayed received source timestamp.",
        };
      } catch (error) {
        if (ownsOutput) await rm(output, { force: true });
        throw error;
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    })();
    return stopPromise;
  }

  const abort = () => fail(abortError());
  session.on("Page.screencastFrame", onFrame);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await cdpCall(
      session.send("Page.startScreencast", {
        format: "jpeg",
        quality: 80,
        maxWidth: 1920,
        maxHeight: 1080,
        everyNthFrame: 1,
      }),
    );
    if (signal?.aborted) throw abortError();
    if (failure) throw failure;
    deadline = setTimeout(
      () => fail(new Error("Video duration limit exceeded")),
      VIDEO_LIMITS.durationMs,
    );
    return { stop };
  } catch (error) {
    fail(error);
    await stop();
    throw error;
  }
}
