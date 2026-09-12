// @vitest-environment node
import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { PassThrough } from "node:stream";
import type { Page } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  chmod: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
}));
import { spawn } from "node:child_process";
import { chmod, mkdir, rm, stat, writeFile } from "node:fs/promises";
import {
  assertVideoPrerequisites,
  startVideoCapture,
  VIDEO_LIMITS,
  videoTimeline,
} from "./video.ts";

function renderer() {
  const session = Object.assign(new EventEmitter(), {
    send: vi.fn(async (_method: string, _params?: unknown) => ({})),
    detach: vi.fn(async () => {}),
  });
  const newCDPSession = vi.fn(async () => session);
  const page = { context: () => ({ newCDPSession }) } as unknown as Page;
  const frame = (timestamp = 100, data = "aGVsbG8=", width = 1920, height = 1080) => {
    session.emit("Page.screencastFrame", {
      sessionId: 7,
      data,
      metadata: { timestamp, deviceWidth: width, deviceHeight: height },
    });
  };
  return { page, session, newCDPSession, frame };
}

function encoder(autoClose = true) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit("close", null));
      return true;
    }),
  });
  vi.mocked(spawn).mockImplementation(() => {
    if (autoClose)
      queueMicrotask(() => {
        child.stdout.write(" V..... libx264 H.264 encoder\n");
        child.emit("close", 0);
      });
    return child as unknown as ReturnType<typeof spawn>;
  });
  return child;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mkdir).mockResolvedValue(undefined);
  vi.mocked(writeFile).mockResolvedValue(undefined);
  vi.mocked(rm).mockResolvedValue(undefined);
  vi.mocked(chmod).mockResolvedValue(undefined);
  vi.mocked(stat).mockResolvedValue({ size: 123 } as Awaited<ReturnType<typeof stat>>);
  encoder();
});
afterEach(() => vi.useRealTimers());

describe("renderer video timeline", () => {
  it("preserves irregular update timestamps and holds the last frame until stop", () => {
    const timeline = videoTimeline(
      [
        { file: "frame-000000.jpg", timestamp: 100 },
        { file: "frame-000001.jpg", timestamp: 100.125 },
        { file: "frame-000002.jpg", timestamp: 102 },
      ],
      105,
    );
    expect(timeline.durationSeconds).toBe(5);
    expect(timeline.concat).toBe(
      [
        "ffconcat version 1.0",
        "file 'frame-000000.jpg'",
        "option framerate 1000000",
        "duration 0.125000",
        "file 'frame-000001.jpg'",
        "option framerate 1000000",
        "duration 1.875000",
        "file 'frame-000002.jpg'",
        "option framerate 1000000",
        "duration 3.000000",
        "file 'frame-000002.jpg'",
        "option framerate 1000000",
        "",
      ].join("\n"),
    );
  });

  it("stably sorts reordered updates and ties without mutating or dropping receipt records", () => {
    const frames = [
      { file: "frame-0.jpg", timestamp: 2 },
      { file: "frame-1.jpg", timestamp: 1 },
      { file: "frame-2.jpg", timestamp: 2 },
    ];
    const timeline = videoTimeline(frames, 3);
    expect(timeline.durationSeconds).toBe(2);
    expect(timeline.concat.match(/^file .+$/gm)).toEqual([
      "file 'frame-1.jpg'",
      "file 'frame-0.jpg'",
      "file 'frame-2.jpg'",
      "file 'frame-2.jpg'",
    ]);
    expect(timeline.concat.match(/^duration .+$/gm)).toEqual([
      "duration 1.000000",
      "duration 0.000000",
      "duration 1.000000",
    ]);
    expect(frames.map((frame) => frame.timestamp)).toEqual([2, 1, 2]);
  });

  it("rejects empty, unsafe and invalid metadata rather than claiming a video", () => {
    expect(() => videoTimeline([], 5)).toThrow("no renderer frames");
    expect(() => videoTimeline([{ file: "frame-0.jpg", timestamp: 5 }], 5)).toThrow(
      "stop timestamp",
    );
    expect(() => videoTimeline([{ file: "../secret", timestamp: 0 }], 1)).toThrow("Invalid");
    expect(() => videoTimeline([{ file: "frame-0.jpg", timestamp: NaN }], 1)).toThrow("Invalid");
  });
});

describe("renderer video lifecycle", () => {
  it("retains late older JPEGs and source-sorts offline without inflating the stop clock", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const { page, frame } = renderer();
      const capture = await startVideoCapture(page, "/owned/run");
      now = 100;
      frame(100.1);
      now = 500;
      frame(100); // Older source update, but slower asynchronous JPEG delivery.
      now = 650;
      frame(100.6);
      now = 1000;
      const report = await capture.stop();
      expect(report).toMatchObject({ frames: 3, droppedFrames: 0, outOfOrderFrames: 1 });
      expect(report.durationSeconds).toBeCloseTo(1, 6);
      const manifest = vi
        .mocked(writeFile)
        .mock.calls.find(([path]) => String(path).endsWith("frames.json"))!;
      expect(JSON.parse(String(manifest[1]))).toEqual([
        {
          file: "frame-000000.jpg",
          timestamp: 100.1,
          receivedAtMs: 100,
          metadata: { timestamp: 100.1, deviceWidth: 1920, deviceHeight: 1080 },
        },
        {
          file: "frame-000001.jpg",
          timestamp: 100,
          receivedAtMs: 500,
          metadata: { timestamp: 100, deviceWidth: 1920, deviceHeight: 1080 },
        },
        {
          file: "frame-000002.jpg",
          timestamp: 100.6,
          receivedAtMs: 650,
          metadata: { timestamp: 100.6, deviceWidth: 1920, deviceHeight: 1080 },
        },
      ]);
      const concat = String(
        vi
          .mocked(writeFile)
          .mock.calls.find(([path]) => String(path).endsWith("timeline.ffconcat"))![1],
      );
      expect(concat.match(/^file .+$/gm)).toEqual([
        "file 'frame-000001.jpg'",
        "file 'frame-000000.jpg'",
        "file 'frame-000002.jpg'",
        "file 'frame-000002.jpg'",
      ]);
      expect(concat.match(/^duration .+$/gm)).toEqual([
        "duration 0.100000",
        "duration 0.500000",
        "duration 0.400000",
      ]);
    } finally {
      clock.mockRestore();
    }
  });

  it("still enforces the source duration bound when an excessively old frame arrives late", async () => {
    const { page, frame } = renderer();
    const capture = await startVideoCapture(page, "/owned/run");
    frame(1000);
    frame(1000 - VIDEO_LIMITS.durationMs / 1000 - 1);
    await expect(capture.stop()).rejects.toThrow("duration limit");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("uses the explicit public CDP target, owner-only artifacts and offline bounded H264 output", async () => {
    const { page, session, newCDPSession, frame } = renderer();
    const capture = await startVideoCapture(page, "/owned/run");
    frame(100, "aGVsbG8=", 4001, 3001);
    const stopped = capture.stop();
    expect(capture.stop()).toBe(stopped);
    const report = await stopped;
    expect(newCDPSession).toHaveBeenCalledWith(page);
    expect(session.send).toHaveBeenCalledWith("Page.startScreencast", {
      format: "jpeg",
      quality: 80,
      maxWidth: 1920,
      maxHeight: 1080,
      everyNthFrame: 1,
    });
    expect(session.send).toHaveBeenCalledWith("Page.screencastFrameAck", { sessionId: 7 });
    expect(session.send).toHaveBeenCalledWith("Page.stopScreencast");
    expect(session.detach).toHaveBeenCalledOnce();
    expect(session.listenerCount("Page.screencastFrame")).toBe(0);
    expect(mkdir).toHaveBeenCalledWith("/owned/run/video-frames", { mode: 0o700 });
    expect(writeFile).toHaveBeenCalledWith(
      "/owned/run/video-frames/frame-000000.jpg",
      Buffer.from("hello"),
      { mode: 0o600 },
    );
    expect(chmod).toHaveBeenCalledWith("/owned/run/video.mp4", 0o600);
    expect(report).toMatchObject({
      mode: "cdp-screencast",
      path: "/owned/run/video.mp4",
      frames: 1,
      bytes: 123,
      sourceBytes: 5,
      droppedFrames: 0,
      dimensions: { width: 1438, height: 1080 },
      outputFps: 60,
    });
    expect(report.limitation).toContain("not presented FPS");
    const args = vi.mocked(spawn).mock.calls[0]![1];
    expect(args).toEqual(expect.arrayContaining(["-an", "libx264", "yuv420p", "+faststart", "60"]));
    // Output -r alone can cut off the final hold; the fps filter fills its timeline.
    expect(args).toEqual(
      expect.arrayContaining([
        expect.stringContaining("format=yuv420p,fps=60"),
        "-color_range",
        "tv",
      ]),
    );
    expect(session.detach.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(spawn).mock.invocationCallOrder[0]!,
    );
  });

  it("ACKs queued writes promptly, bounds the backlog and awaits disk before detach", async () => {
    let release!: () => void;
    const disk = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(writeFile).mockImplementation(async (path) => {
      if (String(path).endsWith(".jpg")) await disk;
    });
    const { page, session, frame } = renderer();
    const capture = await startVideoCapture(page, "/owned/run");
    for (let i = 0; i <= VIDEO_LIMITS.pendingFrames; i++) frame(100 + i);
    expect(
      session.send.mock.calls.filter(([method]) => method === "Page.screencastFrameAck"),
    ).toHaveLength(VIDEO_LIMITS.pendingFrames + 1);
    expect(vi.mocked(writeFile).mock.calls).toHaveLength(VIDEO_LIMITS.pendingFrames);
    expect(session.detach).not.toHaveBeenCalled();
    const stopped = expect(capture.stop()).rejects.toThrow("queue limit");
    release();
    await stopped;
    expect(session.detach).toHaveBeenCalledOnce();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(["write", "ack", "stop", "start"])(
    "cleans up a %s error without an unhandled rejection",
    async (kind) => {
      const { page, session, frame } = renderer();
      session.send.mockImplementation(async (method) => {
        if (
          method ===
          (
            {
              ack: "Page.screencastFrameAck",
              stop: "Page.stopScreencast",
              start: "Page.startScreencast",
            } as Record<string, string>
          )[kind]
        ) {
          throw new Error(`${kind} failed`);
        }
        return {};
      });
      if (kind === "write") vi.mocked(writeFile).mockRejectedValueOnce(new Error("write failed"));
      if (kind === "start")
        await expect(startVideoCapture(page, "/owned/run")).rejects.toThrow("start failed");
      else {
        const capture = await startVideoCapture(page, "/owned/run");
        frame();
        await expect(capture.stop()).rejects.toThrow(`${kind} failed`);
      }
      expect(session.detach).toHaveBeenCalledOnce();
      expect(session.listenerCount("Page.screencastFrame")).toBe(0);
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it("fails the duration ceiling instead of encoding a silently truncated recording", async () => {
    vi.useFakeTimers();
    const { page, session, frame } = renderer();
    const capture = await startVideoCapture(page, "/owned/run");
    frame();
    await vi.advanceTimersByTimeAsync(VIDEO_LIMITS.durationMs);
    await expect(capture.stop()).rejects.toThrow("duration limit");
    expect(session.detach).toHaveBeenCalledOnce();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects oversized frames before decoding or writing them but still ACKs", async () => {
    const { page, session, frame } = renderer();
    const capture = await startVideoCapture(page, "/owned/run");
    frame(100, "A".repeat(Math.ceil(VIDEO_LIMITS.frameBytes / 3) * 4 + 4));
    await expect(capture.stop()).rejects.toThrow("frame byte limit");
    expect(session.send).toHaveBeenCalledWith("Page.screencastFrameAck", { sessionId: 7 });
    expect(vi.mocked(writeFile).mock.calls.some(([path]) => String(path).endsWith(".jpg"))).toBe(
      false,
    );
  });

  it.each(["frames", "bytes"])(
    "fails the aggregate %s ceiling instead of returning a partial success",
    async (limit) => {
      const { page, session, frame } = renderer();
      const capture = await startVideoCapture(page, "/owned/run");
      const count =
        limit === "frames" ? VIDEO_LIMITS.frames : VIDEO_LIMITS.bytes / VIDEO_LIMITS.frameBytes;
      const largeFrame = limit === "bytes" ? Buffer.alloc(VIDEO_LIMITS.frameBytes) : undefined;
      const decode = largeFrame ? vi.spyOn(Buffer, "from") : undefined;
      try {
        for (let i = 0; i <= count; i++) {
          if (largeFrame) decode!.mockReturnValueOnce(largeFrame);
          frame(100 + i / 1000);
          // Complete the write and ACK so this exercises totals, not the queue ceiling.
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        await expect(capture.stop()).rejects.toThrow(
          limit === "frames" ? "frame count limit" : "Video byte limit",
        );
        expect(session.detach).toHaveBeenCalledOnce();
        expect(spawn).not.toHaveBeenCalled();
      } finally {
        decode?.mockRestore();
      }
    },
  );

  it("handles a CDP disconnection racing signal cancellation", async () => {
    const { page, session, frame } = renderer();
    const controller = new AbortController();
    const capture = await startVideoCapture(page, "/owned/run", { signal: controller.signal });
    frame();
    session.send.mockRejectedValue(new Error("Target closed"));
    session.detach.mockRejectedValue(new Error("Target closed"));
    controller.abort();
    await expect(capture.stop()).rejects.toThrow("cancelled");
    expect(session.detach).toHaveBeenCalledOnce();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("times out an unresponsive stop request and still detaches", async () => {
    vi.useFakeTimers();
    const { page, session, frame } = renderer();
    const capture = await startVideoCapture(page, "/owned/run");
    frame();
    session.send.mockImplementation(async (method) => {
      if (method === "Page.stopScreencast") return new Promise(() => {});
      return {};
    });
    const rejected = expect(capture.stop()).rejects.toThrow("CDP operation timed out");
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(session.detach).toHaveBeenCalledOnce();
  });

  it("never overwrites or removes an output it did not create", async () => {
    const { page, frame } = renderer();
    const capture = await startVideoCapture(page, "/owned/run");
    frame();
    vi.mocked(writeFile).mockImplementation(async (path) => {
      if (String(path).endsWith("video.mp4")) throw new Error("EEXIST");
    });
    await expect(capture.stop()).rejects.toThrow("EEXIST");
    expect(rm).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects missing frames and pre-cancelled capture", async () => {
    const { page } = renderer();
    await expect(
      startVideoCapture(page, "/owned/run", { signal: AbortSignal.abort() }),
    ).rejects.toThrow("cancelled");
    expect(mkdir).not.toHaveBeenCalled();
    const capture = await startVideoCapture(page, "/owned/run");
    await expect(capture.stop()).rejects.toThrow("no renderer frames");
  });

  it("cancels capture and detaches before browser release", async () => {
    const { page, session, frame } = renderer();
    const controller = new AbortController();
    const capture = await startVideoCapture(page, "/owned/run", { signal: controller.signal });
    frame();
    controller.abort();
    await expect(capture.stop()).rejects.toThrow("cancelled");
    expect(session.detach).toHaveBeenCalledOnce();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(["abort", "timeout"])(
    "kills and awaits only its owned encoder on %s, removing partial output",
    async (reason) => {
      vi.useFakeTimers();
      const child = encoder(false);
      const controller = new AbortController();
      const { page, frame } = renderer();
      const capture = await startVideoCapture(page, "/owned/run", { signal: controller.signal });
      frame();
      const stopped = capture.stop();
      const rejected = expect(stopped).rejects.toThrow(
        reason === "abort" ? "cancelled" : "timed out",
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(spawn).toHaveBeenCalledOnce();
      if (reason === "abort") controller.abort();
      else await vi.advanceTimersByTimeAsync(120_000);
      await rejected;
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      expect(rm).toHaveBeenCalledWith("/owned/run/video.mp4", { force: true });
    },
  );
});

describe("video prerequisites", () => {
  it("requires installed libx264 without installing anything", async () => {
    await assertVideoPrerequisites();
    expect(spawn).toHaveBeenCalledWith("ffmpeg", ["-hide_banner", "-nostdin", "-encoders"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const child = encoder(false);
    const check = assertVideoPrerequisites();
    const rejected = expect(check).rejects.toThrow("libx264");
    child.emit("close", 0);
    await rejected;
  });

  it("handles a missing executable and a stuck prerequisite child", async () => {
    vi.useFakeTimers();
    const child = encoder(false);
    const check = assertVideoPrerequisites();
    const rejected = expect(check).rejects.toThrow("Cannot run ffmpeg");
    child.emit("error", new Error("ENOENT"));
    child.emit("close", -2);
    await rejected;
    const stuck = encoder(false);
    const timeout = expect(assertVideoPrerequisites()).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10_000);
    await timeout;
    expect(stuck.kill).toHaveBeenCalledWith("SIGKILL");
    expect(vi.getTimerCount()).toBe(0);
  });
});
