import { FileDiff } from "@pierre/diffs/react";
import type { LineDiffTypes, SelectedLineRange } from "@pierre/diffs";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useState } from "react";
import { resolvedAppearanceAtom } from "../atoms/appearance";
import { useElementWidth } from "../hooks/use-element-width";
import { cn } from "../lib/cn";
import {
  hasTwoSidedChanges,
  resolveDiffLayout,
  type DiffLayout,
  type DiffLayoutPreference,
} from "../lib/diff-layout";
import { hideWhitespaceChanges } from "../lib/diff-whitespace";
import { resolveFileDiff } from "../lib/file-diffs";
import { pierreViewerStyle, pierreViewerTheme } from "./file-viewer-theme";

export const FileDiffView = memo(function FileDiffView({
  file,
  patch,
  before,
  after,
  expandUnchanged = false,
  layout = "unified",
  lineDiffType = "word",
  hideWhitespace = false,
  onLayoutResolved,
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
  /** Auto measures this view's width; inline transcript previews stay unified. */
  layout?: DiffLayoutPreference;
  lineDiffType?: LineDiffTypes;
  /** Folds whitespace-only line changes in `patch` into context. */
  hideWhitespace?: boolean;
  /** Reports the layout in effect, for toolbars that show it. */
  onLayoutResolved?(layout: DiffLayout): void;
  className?: string;
  ariaLabel?: string | null;
  selectedLines?: SelectedLineRange | null;
  onSelectedLinesChange?(range: SelectedLineRange | null): void;
}) {
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const width = useElementWidth(layout === "auto" ? container : null);
  const filtered = useMemo(
    () => (hideWhitespace && patch ? hideWhitespaceChanges(patch) : null),
    [hideWhitespace, patch],
  );
  const diff = useMemo(
    () =>
      filtered?.whitespaceOnly
        ? null
        : resolveFileDiff({ file, patch: filtered?.patch ?? patch, before, after }),
    [after, before, file, filtered, patch],
  );
  const diffStyle = resolveDiffLayout(layout, { width, twoSided: hasTwoSidedChanges(diff) });
  useEffect(() => onLayoutResolved?.(diffStyle), [diffStyle, onLayoutResolved]);
  const options = useMemo(
    () => ({
      ...pierreViewerTheme,
      theme: appearance.codeThemePair,
      themeType: appearance.scheme,
      diffStyle,
      hunkSeparators: "line-info-basic" as const,
      lineDiffType,
      diffIndicators: "none" as const,
      expandUnchanged,
      ...(onSelectedLinesChange
        ? { enableLineSelection: true, onLineSelectionEnd: onSelectedLinesChange }
        : {}),
    }),
    [
      appearance.codeThemePair,
      appearance.scheme,
      diffStyle,
      expandUnchanged,
      lineDiffType,
      onSelectedLinesChange,
    ],
  );
  if (filtered?.whitespaceOnly) {
    return (
      <div className="p-3 text-xs text-muted-foreground">Only whitespace changed in {file}.</div>
    );
  }
  if (!diff) {
    return <div className="p-3 text-xs text-muted-foreground">Diff unavailable for {file}.</div>;
  }
  return (
    <div
      ref={setContainer}
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
