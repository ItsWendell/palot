import { toast } from "@/components/ui/toast";
import type { Notice } from "./controller";

/** The list's notices as the app's toasts; Undo is the toast's action button. */
export function toastNotice(notice: Notice) {
  toast.add({
    type: notice.type,
    title: notice.title,
    ...(notice.description ? { description: notice.description } : {}),
    timeout: notice.undo ? 6_000 : notice.type === "error" ? 6_000 : 3_000,
    ...(notice.undo
      ? {
          actionProps: {
            children: "Undo",
            onClick: () => void notice.undo?.(),
          },
        }
      : {}),
  });
}
