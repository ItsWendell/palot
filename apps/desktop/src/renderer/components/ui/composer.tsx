/**
 * The composer's presentational parts, composed in JSX like Palot's other shadcn primitives.
 * They know nothing about OpenCode, atoms or services: props and children in, callbacks out.
 * Every part sets `data-slot` and exposes its state as data attributes so a parent can restyle
 * its children (`group-data-[mode=shell]/composer:`, `group-data-[compact]/composer-footer:`).
 *
 * ComposerDock            the column around the card; width and `@container/composer`
 *   ComposerNotice        one condition line above the card
 *   ComposerTabs          standing context on the card's top edge, folding into "+N"
 *     ComposerTab         (ComposerTabLabel, ComposerTabDetail)
 *   Composer              the card (`mode`, `disabled`, `dragOver`)
 *     ComposerPanel       the slot that grows from the top edge (ComposerPanelBody scrolls)
 *     ComposerQueue       queued messages (ComposerQueueRow…, ComposerQueueSummary)
 *     ComposerHeader      chips above the text
 *     ComposerInputArea   holds the editor; ComposerError is its one error line
 *     ComposerFooter      the control row that never wraps
 *       ComposerActions   `align="start" | "end"`
 *       ComposerFoldable  a control that may fold into ComposerOverflow (ComposerOverflowItem)
 *       ComposerPill      agent and model triggers (ComposerPillLabel, …Detail, …Chevron)
 *       ComposerContextPie, ComposerPrimary, ComposerStop
 */

export { Composer, ComposerError, ComposerHeader, ComposerInputArea } from "./composer/card";
export type { ComposerMode } from "./composer/card";
export {
  ComposerContextPie,
  ComposerContextPieGlyph,
  ComposerPill,
  ComposerPillChevron,
  ComposerPillDetail,
  ComposerPillLabel,
  ComposerPrimary,
  ComposerShortcut,
  ComposerStop,
  composerPillVariants,
  shortcutGlyphs,
} from "./composer/controls";
export type { ComposerPrimaryView } from "./composer/controls";
export { ComposerDock } from "./composer/dock";
export {
  ComposerActions,
  ComposerFoldable,
  ComposerFooter,
  ComposerOverflow,
  ComposerOverflowItem,
} from "./composer/footer";
export {
  ComposerNotice,
  ComposerNoticeAction,
  ComposerNoticeMore,
  ComposerNoticeText,
} from "./composer/notice";
export { ComposerPanel, ComposerPanelBody } from "./composer/panel";
export {
  ComposerQueue,
  ComposerQueueRow,
  ComposerQueueRowActions,
  ComposerQueueRowStatus,
  ComposerQueueRowText,
  ComposerQueueSummary,
} from "./composer/queue";
export { ComposerTab, ComposerTabDetail, ComposerTabLabel, ComposerTabs } from "./composer/tabs";
