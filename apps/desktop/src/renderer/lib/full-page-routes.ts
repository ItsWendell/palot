/**
 * Workspace destinations that own the whole content area, with their own list pane.
 * The task column stays hidden on them; the rail can still open it as an overlay.
 */
const FULL_PAGE_ROUTES = ["/pull-requests", "/usage", "/worktrees", "/scheduled"] as const;

export function isFullPageRoute(pathname: string): boolean {
  return FULL_PAGE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
