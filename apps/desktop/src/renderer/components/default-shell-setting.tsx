import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { showErrorToast } from "../lib/toast-error";
import {
  loadShellSettings,
  shellSelectOptions,
  updateDefaultShell,
  type ShellSettings,
} from "../services/opencode-settings";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { SettingsRow } from "./settings-layout";

const AUTO = "__auto__";

// Nested under the settings key so `config.updated` events and saves refresh it.
export function shellSettingsKey(connectionID: string) {
  return [...openCodeKeys.settings(connectionID), "shell"] as const;
}

/** Default shell for the current task's OpenCode server, saved in its global config. */
export function DefaultShellSetting() {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const available = canFetchOpenCode(runtime);
  const queryClient = useQueryClient();
  const queryKey = shellSettingsKey(connectionID);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => loadShellSettings(connectionID, signal),
    enabled: available,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const mutation = useMutation({
    mutationFn: (shell: string | null) => updateDefaultShell(connectionID, shell),
    onMutate: async (shell) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const previous = queryClient.getQueryData<ShellSettings>(queryKey);
      if (previous) queryClient.setQueryData<ShellSettings>(queryKey, { ...previous, shell });
      return { previous };
    },
    onError: (error, _shell, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      showErrorToast("Could not change the default shell", error);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: openCodeKeys.settings(connectionID) }),
  });

  const settings = query.data;
  const options = settings ? shellSelectOptions(settings) : [];
  const current = settings?.shell ?? null;
  const currentLabel = current
    ? (options.find((option) => option.value === current)?.label ?? current)
    : "Auto";
  const status = !available
    ? "Connect to an OpenCode server to choose its shell."
    : query.isPending
      ? "Loading available shells…"
      : undefined;

  return (
    <SettingsRow
      title="Default shell"
      description="The shell OpenCode uses for terminals and agent commands. Auto lets OpenCode choose. Applies to every project on the current task's server."
      status={status}
      control={
        query.isError ? (
          <>
            <span role="alert" className="text-meta text-destructive">
              {query.error instanceof Error ? query.error.message : "Could not load shells."}
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </>
        ) : (
          <Select
            value={current ?? AUTO}
            disabled={!available || !settings || mutation.isPending}
            onValueChange={(value) => {
              const shell = value === AUTO || value === null ? null : value;
              if (shell !== current) mutation.mutate(shell);
            }}
          >
            <SelectTrigger className="w-full @lg/settings:w-48" aria-label="Default shell">
              <SelectValue>{currentLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={AUTO}>Auto</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                  {option.terminalOnly ? (
                    <span className="ml-auto pl-3 text-meta text-muted-foreground">
                      Terminal only
                    </span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    />
  );
}
