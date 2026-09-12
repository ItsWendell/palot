import { FileDiff } from "@pierre/diffs/react";
import { useAtomValue } from "jotai";
import { memo, useMemo } from "react";
import { resolvedAppearanceAtom } from "../atoms/appearance";
import { cn } from "../lib/cn";
import { resolveFileReadDiff } from "../lib/file-diffs";
import { pierreViewerStyle, pierreViewerTheme } from "./file-viewer-theme";

export const FileReadView = memo(function FileReadView({
  file,
  start,
  lines,
  className,
  ariaLabel,
}: {
  file: string;
  start: number;
  lines: Array<{ number: number; text: string }>;
  className?: string;
  ariaLabel?: string | null;
}) {
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const fileDiff = useMemo(() => resolveFileReadDiff(file, start, lines), [file, lines, start]);
  if (!fileDiff) return null;
  const options = {
    ...pierreViewerTheme,
    theme: appearance.codeThemePair,
    themeType: appearance.scheme,
    diffStyle: "unified",
    diffIndicators: "none",
    hunkSeparators: "simple",
    lineDiffType: "none",
  } as const;

  return (
    <div
      className={cn("overflow-auto rounded-lg border bg-card text-diff", className)}
      tabIndex={ariaLabel === null ? undefined : 0}
      aria-label={ariaLabel === null ? undefined : (ariaLabel ?? `File contents for ${file}`)}
    >
      <FileDiff fileDiff={fileDiff} options={options} style={pierreViewerStyle} />
    </div>
  );
});
