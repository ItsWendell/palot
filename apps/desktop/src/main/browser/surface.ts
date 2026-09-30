/** A browser page's presentation; all operations remain main-owned. */
export interface BrowserPageSurface {
  contents: Electron.WebContents;
  /** Set only for managed popup windows. Embedded pages use the owning app window. */
  window?: Electron.BrowserWindow;
  focus?(): void;
  layout(bounds: Electron.Rectangle, background?: string, radius?: number): void;
  setVisible(visible: boolean): void;
  getVisible(): boolean;
  getBounds(): Electron.Rectangle;
  dispose(): void | Promise<void>;
}
