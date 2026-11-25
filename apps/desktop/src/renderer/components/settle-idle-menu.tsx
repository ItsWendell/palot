import { toast } from "./ui/toast";

/** One toast for a batch of settled tasks, with Undo for the whole batch. */
export function announceSettledBatch(input: {
  count: number;
  title?: string;
  description?: string;
  undo(): Promise<unknown>;
}): void {
  const tasks = input.count === 1 ? "1 task" : `${input.count} tasks`;
  toast.add({
    type: "success",
    title: input.title ?? `Settled ${tasks}`,
    ...(input.description ? { description: input.description } : {}),
    actionProps: {
      children: "Undo",
      onClick: () =>
        void input.undo().catch((error: unknown) =>
          toast.add({
            type: "error",
            title: "Could not move tasks back to Inbox",
            description: error instanceof Error ? error.message : undefined,
          }),
        ),
    },
  });
}
