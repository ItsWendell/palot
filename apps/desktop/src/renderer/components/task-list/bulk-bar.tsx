/** The slim bar for a multi-selection: "3 selected · Settle · Snooze · Mark read · ×". */

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { spring } from "@/lib/springs";
import { useController, useTaskList } from "./context";

export const BulkBar = memo(function BulkBar() {
  const controller = useController();
  const keys = useTaskList((state) => state.selection.keys);
  const reduce = useReducedMotion();
  const offset = reduce ? 0 : 8;
  return (
    <AnimatePresence>
      {keys.length > 0 ? (
        <motion.div
          key="bulk"
          role="toolbar"
          aria-label={`${keys.length} selected`}
          data-bulk-bar=""
          className="absolute inset-x-2 bottom-2 z-20 flex h-8 items-center gap-0.5 rounded-md bg-popover pr-1 pl-2.5 text-meta text-popover-foreground shadow-md ring-1 ring-foreground/10"
          initial={{ opacity: 0, y: offset }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: offset, transition: spring.moderate.exit }}
          transition={spring.moderate}
        >
          <span className="mr-auto font-medium whitespace-nowrap tabular-nums">
            {keys.length} selected
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="text-meta"
            onClick={() => void controller.settle(keys)}
          >
            Settle
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-meta"
            data-snooze-anchor="bulk"
            onClick={() => controller.openSnoozeMenu([...keys], "bulk")}
          >
            Snooze
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-meta"
            onClick={() => void controller.setUnread(keys, false)}
          >
            Mark read
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Clear selection"
            className="text-muted-foreground"
            onClick={() => controller.clearSelection()}
          >
            <X aria-hidden="true" />
          </Button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
});
