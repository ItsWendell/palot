import { useAtomValue } from "jotai";
import { useEffect, useMemo } from "react";
import { newTaskProjectIDAtom, runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";
import { useProjectCatalog, useSelectedSession } from "./use-session-catalog";

/**
 * Tells Palot where this window's tasks run, so its agent tools (scheduling, reading and
 * organizing tasks) are attached there before a turn starts. OpenCode scopes them to a
 * directory. Main also attaches them wherever a task is running.
 */
export function usePalotToolsFocus(): void {
  const runtime = useAtomValue(runtimeAtom);
  const session = useSelectedSession();
  const newTaskProjectID = useAtomValue(newTaskProjectIDAtom);
  const projects = useProjectCatalog();
  const connectionID = runtime?.connected ? runtime.connectionID : null;
  const sessionDirectory = session?.location.directory;
  const projectDirectory = newTaskProjectID
    ? projects.find((project) => project.id === newTaskProjectID)?.canonical
    : undefined;
  const directories = useMemo(
    () => [...new Set([sessionDirectory, projectDirectory].filter((value) => value !== undefined))],
    [projectDirectory, sessionDirectory],
  );
  const key = connectionID ? JSON.stringify([connectionID, directories]) : null;

  useEffect(() => {
    if (!key) return;
    const [id, list] = JSON.parse(key) as [string, string[]];
    void palot.setPalotToolsFocus({ connectionID: id, directories: list }).catch(() => undefined);
  }, [key]);

  useEffect(() => () => void palot.setPalotToolsFocus(null).catch(() => undefined), []);
}
