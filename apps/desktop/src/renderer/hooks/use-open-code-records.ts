import { eq, useLiveQuery } from "@tanstack/react-db";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
  OpenCodeDataGraphRecord,
  OpenCodeDataGraphRecordKind,
} from "../lib/open-code-data-graph";
import { openCodeReconciler } from "../lib/open-code-reconciler";

export function useOpenCodeRecords<TKind extends OpenCodeDataGraphRecordKind>(
  connectionID: string,
  kind: TKind,
  sessionID?: string | null,
): Array<Extract<OpenCodeDataGraphRecord, { kind: TKind }>> {
  const queryClient = useQueryClient();
  const collection = openCodeReconciler(queryClient).graph.collection;
  const query = useLiveQuery({
    queryKey: [collection.id, connectionID, kind, sessionID ?? null],
    query: (q) => {
      const records = q
        .from({ record: collection })
        .where(({ record }) => eq(record.connectionID, connectionID));
      const filtered =
        sessionID === undefined
          ? records.fn.where(({ record }) => record.kind === kind)
          : records.fn.where(
              ({ record }) => record.kind === kind && record.sessionID === sessionID,
            );
      // Preserve the record union; fn.where does not narrow the query's result type.
      return filtered.fn.select(({ record }) => record);
    },
  });
  return useMemo(
    () =>
      (query.data ?? []).filter(
        (record): record is typeof record & Extract<OpenCodeDataGraphRecord, { kind: TKind }> =>
          record.kind === kind,
      ),
    [query.data, kind],
  );
}
