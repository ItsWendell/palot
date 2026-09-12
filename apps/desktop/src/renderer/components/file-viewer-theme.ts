import type { CSSProperties } from "react";

const pierreBaseCSS = `
[data-diff] { border: 0 !important; border-radius: 0 !important; }
[data-line] { min-height: var(--diffs-line-height); }
[data-column-number] { font-variant-numeric: tabular-nums; }
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
  "--diffs-bg-addition-override": "color-mix(in oklch, var(--success) 14%, var(--code-background))",
  "--diffs-bg-addition-emphasis-override":
    "color-mix(in oklch, var(--success) 22%, var(--code-background))",
  "--diffs-bg-addition-number-override":
    "color-mix(in oklch, var(--success) 18%, var(--code-background))",
  "--diffs-bg-deletion-override":
    "color-mix(in oklch, var(--destructive) 13%, var(--code-background))",
  "--diffs-bg-deletion-emphasis-override":
    "color-mix(in oklch, var(--destructive) 21%, var(--code-background))",
  "--diffs-bg-deletion-number-override":
    "color-mix(in oklch, var(--destructive) 17%, var(--code-background))",
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
