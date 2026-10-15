import type { CSSProperties } from "react";
import { DIFF_FIND_ACTIVE_HIGHLIGHT, DIFF_FIND_HIGHLIGHT } from "../lib/diff-find-dom";

const pierreBaseCSS = `
[data-diff] { border: 0 !important; border-radius: 0 !important; }
[data-line] { min-height: var(--diffs-line-height); }
[data-column-number] { font-variant-numeric: tabular-nums; }
/* Changed-row fills are final translucent colors, so Pierre must not blend them into the background again. */
[data-background]
  :is([data-line], [data-no-newline], [data-column-number], [data-gutter-buffer]):is(
    [data-line-type="change-addition"],
    [data-line-type="change-deletion"]
  ) {
  --mix-light: 0%;
  --mix-dark: 0%;
}
/* Syntax colors are inline token styles, so changed words need !important to stay legible on their highlight. */
[data-line-type="change-addition"] [data-diff-span],
[data-line-type="change-addition"] [data-diff-span] * {
  color: light-dark(color-mix(in oklch, var(--success) 45%, var(--foreground)), var(--foreground)) !important;
}
[data-line-type="change-deletion"] [data-diff-span],
[data-line-type="change-deletion"] [data-diff-span] * {
  color: light-dark(color-mix(in oklch, var(--destructive) 45%, var(--foreground)), var(--foreground)) !important;
}
/* Find in diff: document styles do not reach this shadow tree, so the rules live here. */
::highlight(${DIFF_FIND_HIGHLIGHT}) { background-color: color-mix(in oklch, var(--warning) 30%, transparent); }
::highlight(${DIFF_FIND_ACTIVE_HIGHLIGHT}) { background-color: var(--primary); color: var(--primary-foreground); }
@media (forced-colors: active) {
  ::highlight(${DIFF_FIND_HIGHLIGHT}) { background-color: Mark; color: MarkText; }
  ::highlight(${DIFF_FIND_ACTIVE_HIGHLIGHT}) { background-color: Highlight; color: HighlightText; }
}
`;

export const pierreViewerCSS = `
${pierreBaseCSS}
[data-diffs-header] { display: none !important; }
`;

export const pierreReviewCSS = `
${pierreBaseCSS}
[data-diff] { border: 0 !important; }
[data-diffs-header] {
  min-height: 32px;
  border: 0 !important;
  background: var(--card);
  box-shadow: none !important;
  padding: 0 !important;
}
[data-header-content] { min-width: 0; font-size: var(--theme-tree-font-size); font-weight: 500; }
[data-change-icon], [data-rename-icon] { width: 12px; height: 12px; }
[data-title] { min-width: 0; }
[data-title] bdi { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-metadata] { gap: 8px; font-size: var(--theme-diff-font-size); }
[data-diffs-header] > slot { width: 100%; }
`;

/**
 * Inline padding for the library's own file header. Review surfaces that render a custom
 * header (Changes, pull request Code) pad their own content; views that keep the built-in
 * header add this so the change icon and metadata don't touch the pane edges.
 */
export const pierreBuiltInHeaderCSS = `
[data-header-content] { padding-inline-start: 12px; gap: 8px; }
[data-metadata] { padding-inline-end: 12px; }
`;

export const pierreViewerStyle = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-header-font-family": "var(--font-sans)",
  "--diffs-font-size": "var(--theme-diff-font-size)",
  "--diffs-line-height": "calc(var(--theme-diff-font-size) + 6px)",
  "--diffs-light-bg": "var(--code-background)",
  "--diffs-dark-bg": "var(--code-background)",
  "--diffs-fg-number-override": "color-mix(in oklch, var(--muted-foreground) 62%, transparent)",
  "--diffs-bg-context-override": "var(--code-background)",
  "--diffs-bg-context-gutter-override": "var(--muted)",
  "--diffs-bg-separator-override": "var(--muted)",
  // Changed rows and their gutters share one translucent fill. pierreBaseCSS zeroes Pierre's
  // background mix on those rows, so these values are what the reader actually sees.
  "--diffs-bg-addition-override":
    "light-dark(color-mix(in oklch, var(--success) 10%, transparent), color-mix(in oklch, var(--success) 12%, transparent))",
  "--diffs-bg-addition-number-override": "var(--diffs-bg-addition-override)",
  "--diffs-bg-addition-emphasis-override":
    "light-dark(color-mix(in oklch, var(--success) 24%, transparent), color-mix(in oklch, var(--success) 32%, transparent))",
  "--diffs-bg-deletion-override":
    "light-dark(color-mix(in oklch, var(--destructive) 9%, transparent), color-mix(in oklch, var(--destructive) 12%, transparent))",
  "--diffs-bg-deletion-number-override": "var(--diffs-bg-deletion-override)",
  "--diffs-bg-deletion-emphasis-override":
    "light-dark(color-mix(in oklch, var(--destructive) 22%, transparent), color-mix(in oklch, var(--destructive) 32%, transparent))",
  "--diffs-fg-number-addition-override":
    "light-dark(color-mix(in oklch, var(--success) 80%, var(--foreground)), var(--success))",
  "--diffs-fg-number-deletion-override":
    "light-dark(color-mix(in oklch, var(--destructive) 80%, var(--foreground)), var(--destructive))",
  "--diffs-addition-color-override": "var(--success)",
  "--diffs-deletion-color-override": "var(--destructive)",
  "--diffs-gap-inline": "8px",
  "--diffs-gap-block": "0px",
} as CSSProperties;

export const pierreViewerTheme = {
  disableFileHeader: true,
  overflow: "scroll",
  unsafeCSS: pierreViewerCSS,
} as const;

export const pierreReviewTheme = {
  disableFileHeader: false,
  overflow: "scroll",
  unsafeCSS: pierreReviewCSS,
} as const;
