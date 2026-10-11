import { Tabs } from "@base-ui/react/tabs";
import { LayoutGroup, motion } from "motion/react";
import { useId } from "react";
import { useReducedMotion } from "../hooks/use-reduced-motion";
import { PALETTE_TABS, type PaletteTab } from "../lib/global-command-search";
import { spring } from "../lib/springs";

/**
 * Subtle filter tabs under the palette's search field (Fluid Functionalism TabsSubtle). The
 * active pill travels between tabs on `spring.moderate`. A pointer pick keeps focus in the
 * search field; ← and → are handled by the field itself.
 */
export function PaletteTabs({
  value,
  onValueChange,
}: {
  value: PaletteTab;
  onValueChange(value: PaletteTab): void;
}) {
  const reduceMotion = useReducedMotion();
  const layoutGroup = useId();
  return (
    <Tabs.Root
      value={value}
      onValueChange={(next) => {
        const tab = PALETTE_TABS.find((candidate) => candidate.value === next);
        if (tab) onValueChange(tab.value);
      }}
      className="px-3 pb-2"
    >
      <LayoutGroup id={layoutGroup}>
        <Tabs.List
          aria-label="Filter results"
          data-slot="command-palette-tabs"
          className="flex items-center gap-1"
          onMouseDown={(event) => event.preventDefault()}
        >
          {PALETTE_TABS.map((tab) => (
            <Tabs.Tab
              key={tab.value}
              value={tab.value}
              className="relative flex h-7 items-center rounded-md px-2.5 text-compact font-medium text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-active:text-foreground"
            >
              {tab.value === value ? (
                <motion.span
                  layoutId="palette-tab-pill"
                  aria-hidden="true"
                  className="absolute inset-0 rounded-md bg-muted"
                  transition={reduceMotion ? { duration: 0 } : spring.moderate}
                />
              ) : null}
              <span className="relative">{tab.label}</span>
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </LayoutGroup>
    </Tabs.Root>
  );
}
