import { useMemo, useState } from "react";

type ComposerMenu = "agent" | "model";

const MENUS: readonly ComposerMenu[] = ["agent", "model"];

/** Which row menu is open, and an agent cycle waiting for the agent list to load. */
export function useComposerMenus() {
  const [active, setActive] = useState<ComposerMenu | null>(null);
  const [agentCycle, setAgentCycle] = useState<{ scope: string; direction: 1 | -1 } | null>(null);
  // Closing one picker never closes another that has taken over.
  const onOpenChange = useMemo(
    () =>
      Object.fromEntries(
        MENUS.map((menu) => [
          menu,
          (open: boolean) =>
            setActive((current) => (open ? menu : current === menu ? null : current)),
        ]),
      ) as Record<ComposerMenu, (open: boolean) => void>,
    [],
  );
  return { active, open: setActive, onOpenChange, agentCycle, setAgentCycle };
}

export type ComposerMenus = ReturnType<typeof useComposerMenus>;
