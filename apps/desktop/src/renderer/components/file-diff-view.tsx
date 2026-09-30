import { FileDiff } from "@pierre/diffs/react";
import type { SelectedLineRange } from "@pierre/diffs";
import { useAtomValue } from "jotai";
import { memo, useMemo } from "react";
import { resolvedAppearanceAtom } from "../atoms/appearance";
import { cn } from "../lib/cn";
import { resolveFileDiff } from "../lib/file-diffs";
import { pierreViewerStyle, pierreViewerTheme } from "./file-viewer-theme";

export const FileDiffView = memo(function FileDiffView({
  file,
  patch,
  before,
  after,
  expandUnchanged = false,
  className,
  ariaLabel,
  selectedLines,
  onSelectedLinesChange,
}: {
  file: string;
  patch?: string;
  before?: string;
  after?: string;
  expandUnchanged?: boolean;
  className?: string;
  ariaLabel?: string | null;
  selectedLines?: SelectedLineRange | null;
  onSelectedLinesChange?(range: SelectedLineRange | null): void;
}) {
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const diff = useMemo(
    () => resolveFileDiff({ file, patch, before, after }),
    [after, before, file, patch],
  );
  const options = useMemo(
    () => ({
      ...pierreViewerTheme,
      theme: appearance.codeThemePair,
      themeType: appearance.scheme,
      diffStyle: "unified" as const,
      hunkSeparators: "line-info-basic" as const,
      lineDiffType: "word" as const,
      diffIndicators: "none" as const,
      expandUnchanged,
      ...(onSelectedLinesChange
        ? { enableLineSelection: true, onLineSelectionEnd: onSelectedLinesChange }
        : {}),
    }),
    [appearance.codeThemePair, appearance.scheme, expandUnchanged, onSelectedLinesChange],
  );
  if (!diff) {
    return <div className="p-3 text-xs text-muted-foreground">Diff unavailable for {file}.</div>;
  }
  return (
    <div
      className={cn("overflow-auto bg-card text-diff", className)}
      tabIndex={ariaLabel === null ? undefined : 0}
      aria-label={ariaLabel === null ? undefined : (ariaLabel ?? `Diff contents for ${file}`)}
    >
      <FileDiff
        fileDiff={diff}
        options={options}
        selectedLines={selectedLines}
        style={pierreViewerStyle}
      />
    </div>
  );
});
