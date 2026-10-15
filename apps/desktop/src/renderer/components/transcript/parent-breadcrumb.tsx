import { useCallback } from "react";
import type { PalotSession } from "../../../shared";
import { usePalotNavigation } from "../../hooks/use-navigation";
import { useSessionCatalogSelector } from "../../hooks/use-session-catalog";
import { sessionPresentation } from "../subagent-activity";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "../ui/breadcrumb";

/** "Parent title › Agent · description" for a subagent task; the parent crumb navigates up. */
export function ParentTaskBreadcrumb({
  session,
  onRename,
}: {
  session: PalotSession;
  onRename?: () => void;
}) {
  const { openSession } = usePalotNavigation();
  const parentID = session.parentID;
  const selectParentTitle = useCallback(
    (sessions: PalotSession[]) =>
      sessions.find((candidate) => candidate.id === parentID)?.title?.trim() || null,
    [parentID],
  );
  const parentTitle = useSessionCatalogSelector(selectParentTitle) ?? "Parent task";
  if (!parentID) return null;
  const child = sessionPresentation(session);
  const current = `${child.agent} · ${child.description}`;

  return (
    <Breadcrumb
      aria-label="Task breadcrumb"
      className="window-no-drag min-w-0"
      data-palot-parent-breadcrumb={parentID}
    >
      <BreadcrumbList className="flex-nowrap gap-1 text-compact leading-none">
        <BreadcrumbItem className="min-w-0 shrink">
          <button
            type="button"
            className="block max-w-64 min-w-0 truncate rounded-sm px-0.5 py-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open parent task: ${parentTitle}`}
            title={parentTitle}
            onClick={() => void openSession(parentID)}
          >
            {parentTitle}
          </button>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="shrink-0 text-muted-foreground/60" />
        <BreadcrumbItem className="min-w-0 shrink-[2]">
          <strong
            aria-current="page"
            className="block min-w-0 truncate font-semibold text-foreground"
            title={current}
            onDoubleClick={(event) => {
              if (!onRename) return;
              event.preventDefault();
              onRename();
            }}
          >
            {current}
          </strong>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
