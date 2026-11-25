import { FileDiff } from "@pierre/diffs/react";
import type { FileDiffMetadata, LineDiffTypes, SelectedLineRange } from "@pierre/diffs";
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
import type { DiffFindMatch } from "../lib/diff-find";
import { pierreViewerStyle, pierreViewerTheme } from "./file-viewer-theme";
import { DiffChangeRail, elementRailSource } from "./workbench-tabs/diff-change-rail";

export interface FileDiffFindTarget {
  fileDiff: FileDiffMetadata | null;
  scroller: HTMLDivElement | null;
}

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
  changeRail = false,
  findMatches,
  onFindTargetChange,
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
  /** Shows the change marker rail beside the scroller (full-size diff tabs). */
  changeRail?: boolean;
  /** Find in diff matches to mark on the change rail, or none while Find is closed. */
  findMatches?: readonly DiffFindMatch[];
  /** Reports the parsed diff Find searches and the scroller it highlights in. */
  onFindTargetChange?(target: FileDiffFindTarget): void;
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
  useEffect(
    () => onFindTargetChange?.({ fileDiff: diff, scroller: container }),
    [container, diff, onFindTargetChange],
  );
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
  const scroller = (
    <div
      ref={setContainer}
      className={cn(
        "overflow-auto bg-card text-diff",
        changeRail ? "h-full min-w-0 flex-1" : className,
      )}
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
  if (!changeRail) return scroller;
  return (
    <div className={cn("flex min-h-0 bg-card", className)}>
      {scroller}
      <DiffChangeRail
        container={container}
        source={elementRailSource(container, file, diff)}
        layout={diffStyle}
        expandUnchanged={expandUnchanged}
        matches={findMatches}
        layoutKey={diff}
      />
    </div>
  );
});
