import { watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { desktopProbe } from "./linux-desktop";
import { parseOmarchyPalette, type OmarchyTheme } from "../shared/omarchy-theme";

/** Watches parent directories because Omarchy replaces the active theme directory. */
export class OmarchyAppearance {
  private watchers: FSWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private stopped = false;

  constructor(private readonly onTheme: (theme: OmarchyTheme) => void) {}

  async start(): Promise<void> {
    if (process.platform !== "linux") return;
    const home = homedir();
    for (const directory of [
      path.join(home, ".local/state/omarchy/current"),
      path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "fontconfig"),
      path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "hypr"),
    ]) {
      try {
        const watcher = watch(directory, { persistent: false }, () => this.schedule());
        watcher.on("error", (error) =>
          console.warn("[omarchy] Theme watcher unavailable", error.message),
        );
        this.watchers.push(watcher);
      } catch {
        // Omarchy and font following are optional capabilities.
      }
    }
    await this.refresh();
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }

  private schedule(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, 200);
    this.timer.unref();
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    const [colors, name, font, rounding] = await Promise.all([
      desktopProbe("omarchy", ["theme", "color", "--all"]),
      desktopProbe("omarchy", ["theme", "current"]),
      desktopProbe("omarchy", ["font", "current"]),
      desktopProbe("hyprctl", ["-j", "getoption", "decoration:rounding"]),
    ]);
    if (this.stopped || generation !== this.generation || !colors) return;
    const theme = parseOmarchyPalette(colors, name ?? "Omarchy", font ?? undefined);
    if (theme && rounding) {
      try {
        const value: unknown = JSON.parse(rounding).int;
        if (typeof value === "number" && Number.isFinite(value) && value >= 0)
          theme.rounding = Math.min(value, 32);
      } catch {
        /* Hyprland is optional. */
      }
    }
    if (theme) this.onTheme(theme);
  }
}
