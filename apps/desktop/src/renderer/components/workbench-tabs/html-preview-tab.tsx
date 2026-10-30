import { useAtomValue } from "jotai";
import { resolvedAppearanceAtom } from "../../atoms/appearance";
import { appearanceTheme, type AppearanceThemePalette } from "../../../shared";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { Banner } from "../ui/banner";

export function htmlPreviewDocument(
  html: string,
  dark: boolean,
  palette: Pick<AppearanceThemePalette, "background" | "foreground">,
): string {
  // Prepend policy before any agent markup. A later CSP can only restrict it further.
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none';"><meta name="color-scheme" content="${dark ? "dark" : "light"}"><style>html { background: ${palette.background}; color: ${palette.foreground}; }</style></head><body>${html}</body></html>`;
}

export function HtmlPreviewTab({ tab }: { tab: Extract<WorkbenchTab, { kind: "html-preview" }> }) {
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const { palette } = appearanceTheme(appearance.preferences, appearance.scheme);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Banner title="Scripts are disabled in previews" className="m-2 shrink-0" />
      <iframe
        title="HTML preview"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={htmlPreviewDocument(tab.resource.html, appearance.scheme === "dark", palette)}
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </div>
  );
}
