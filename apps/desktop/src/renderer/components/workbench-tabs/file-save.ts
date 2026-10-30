export interface FileEditSnapshot {
  contents: string;
  dirty: boolean;
  conflict: boolean;
  saving: boolean;
  /** Changes only when disk contents replace the editor, not on echoed keystrokes. */
  generation: number;
}

export interface FileSaveIO {
  canWrite(): boolean;
  read(): Promise<Uint8Array>;
  write(payload: Uint8Array): Promise<unknown>;
  saved(payload: Uint8Array): Promise<void>;
}

/** One explicit-save draft per tab, retained when its pane or task unmounts. */
export class FileEditSession {
  private base: Uint8Array | null = null;
  private disk: Uint8Array | null = null;
  private savedContents = "";
  private listeners = new Set<() => void>();
  private snapshot: FileEditSnapshot = {
    contents: "",
    dirty: false,
    conflict: false,
    saving: false,
    generation: 0,
  };

  getSnapshot = (): FileEditSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  receive(data: Uint8Array, text?: string): void {
    if (this.disk && equalBytes(this.disk, data)) return;
    this.disk = data.slice();
    if (this.snapshot.dirty || this.snapshot.saving) {
      this.update({ conflict: !this.base || !equalBytes(this.base, data) });
    } else if (text !== undefined) {
      this.replace(data, text);
    }
  }

  change(contents: string): void {
    if (!this.base || contents === this.snapshot.contents) return;
    if (
      contents === this.savedContents &&
      !this.snapshot.saving &&
      this.disk &&
      !equalBytes(this.base, this.disk)
    ) {
      this.revert();
      return;
    }
    this.update({ contents, dirty: contents !== this.savedContents });
  }

  /** Revert uses the newest observed disk bytes, including a watch refresh. */
  revert(): void {
    if (!this.disk || this.snapshot.saving) return;
    try {
      this.replace(this.disk, new TextDecoder("utf-8", { fatal: true }).decode(this.disk));
    } catch {
      // A text file can become binary on disk. Discarding still releases the draft.
      this.base = null;
      this.update({
        contents: "",
        dirty: false,
        conflict: false,
        generation: this.snapshot.generation + 1,
      });
    }
  }

  async save(io: FileSaveIO, overwrite = false): Promise<"saved" | "conflict" | "skipped"> {
    if (!this.base || !this.snapshot.dirty || this.snapshot.saving || !io.canWrite())
      return "skipped";
    const base = this.base;
    const contents = this.snapshot.contents;
    // TextDecoder hides a UTF-8 BOM; preserve it without normalizing EOLs or the final newline.
    const bom = base[0] === 0xef && base[1] === 0xbb && base[2] === 0xbf;
    const payload = new TextEncoder().encode(`${bom ? "\ufeff" : ""}${contents}`);
    this.update({ saving: true });
    try {
      const disk = await io.read();
      this.disk = disk.slice();
      if (!overwrite && !equalBytes(base, disk)) {
        this.update({ conflict: true });
        return "conflict";
      }
      // A connection switch while the read was in flight must not write through the old editor.
      if (!io.canWrite()) return "skipped";
      await io.write(payload);
      this.base = payload.slice();
      this.disk = payload.slice();
      this.savedContents = contents;
      this.update({ dirty: this.snapshot.contents !== contents, conflict: false });
      await io.saved(payload);
      return "saved";
    } finally {
      this.update({ saving: false });
    }
  }

  private replace(data: Uint8Array, contents: string): void {
    this.base = data.slice();
    this.savedContents = contents;
    this.update({
      contents,
      dirty: false,
      conflict: false,
      generation: this.snapshot.generation + 1,
    });
  }

  private update(patch: Partial<FileEditSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
