import { describe, expect, it, vi } from "vitest";
import { FileEditSession, type FileSaveIO } from "./file-save";

const bytes = (text: string) => new TextEncoder().encode(text);
function setup(original = "original\n") {
  const session = new FileEditSession();
  session.receive(bytes(original), new TextDecoder().decode(bytes(original)));
  const io: FileSaveIO = {
    canWrite: () => true,
    read: vi.fn(async () => bytes(original)),
    write: vi.fn(async () => {}),
    saved: vi.fn(async () => {}),
  };
  return { session, io };
}

describe("explicit file saving", () => {
  it.each(["changed\r\nnext\r\n", "changed\rnext", "changed\n\n", "", "é🙂"])(
    "writes exact UTF-8 bytes, including the edited trailing newline: %j",
    async (contents) => {
      const { session, io } = setup();
      session.change(contents);
      expect(await session.save(io)).toBe("saved");
      expect(io.write).toHaveBeenCalledWith(bytes(contents));
      expect(io.saved).toHaveBeenCalledWith(bytes(contents));
      expect(session.getSnapshot()).toMatchObject({ dirty: false, saving: false });
    },
  );

  it("preserves a UTF-8 BOM that the displayed text does not include", async () => {
    const { session, io } = setup("\ufefforiginal\r\n");
    session.change("changed\r\n");
    await session.save(io);
    expect(io.write).toHaveBeenCalledWith(bytes("\ufeffchanged\r\n"));
  });

  it("refuses to overwrite a different disk revision until explicitly requested", async () => {
    const { session, io } = setup();
    session.change("mine\n");
    io.read = vi.fn(async () => bytes("agent\n"));
    expect(await session.save(io)).toBe("conflict");
    expect(io.write).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      contents: "mine\n",
      dirty: true,
      conflict: true,
    });
    expect(await session.save(io, true)).toBe("saved");
    expect(io.write).toHaveBeenCalledWith(bytes("mine\n"));
  });

  it("keeps dirty edits across watch refreshes, then reverts to the newest disk contents", () => {
    const { session } = setup();
    session.change("mine\n");
    session.receive(bytes("agent\r\n"), "agent\r\n");
    expect(session.getSnapshot()).toMatchObject({
      contents: "mine\n",
      dirty: true,
      conflict: true,
    });
    session.revert();
    expect(session.getSnapshot()).toMatchObject({
      contents: "agent\r\n",
      dirty: false,
      conflict: false,
    });
    session.receive(bytes("next\n"), "next\n");
    expect(session.getSnapshot().contents).toBe("next\n");
  });

  it("resumes live disk contents when undo makes the draft clean", () => {
    const { session } = setup();
    session.change("mine\n");
    session.receive(bytes("agent\n"), "agent\n");
    session.change("original\n");
    expect(session.getSnapshot()).toMatchObject({
      contents: "agent\n",
      dirty: false,
      conflict: false,
    });
  });

  it("does not mark newer edits saved or start another write while a save is in flight", async () => {
    const { session, io } = setup();
    let finish!: () => void;
    io.write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    session.change("first");
    const pending = session.save(io);
    await Promise.resolve();
    session.change("second");
    expect(await session.save(io)).toBe("skipped");
    finish();
    await pending;
    expect(session.getSnapshot()).toMatchObject({ contents: "second", dirty: true, saving: false });
    expect(io.write).toHaveBeenCalledOnce();
  });

  it("keeps failed writes dirty and never writes after ownership is lost during a read", async () => {
    const { session, io } = setup();
    session.change("mine");
    io.write = vi.fn(async () => {
      throw new Error("failed");
    });
    await expect(session.save(io)).rejects.toThrow("failed");
    expect(session.getSnapshot()).toMatchObject({ dirty: true, saving: false });
    io.canWrite = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    vi.mocked(io.write).mockClear();
    expect(await session.save(io)).toBe("skipped");
    expect(io.write).not.toHaveBeenCalled();
    expect(io.saved).not.toHaveBeenCalled();
  });
});
