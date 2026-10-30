import type { PalotProjectDirectory, PalotSession } from "../../../shared";
import type { PullRequestLink } from "../../../shared/source-control-contract";
import {
  attachedTasks,
  canRetire,
  isWithinDirectory,
  mergedWorktreeCandidates,
  retirementChecklist,
  type RetirementCandidate,
  type RetirementCheck,
} from "./merged-worktree-retirement";

/** Shared by automatic and explicit runs. Unknown/changed state always keeps the worktree. */
export async function cleanMergedWorktrees(input: {
  projectID: string;
  canonical: string;
  worktrees: PalotProjectDirectory[];
  sessions: PalotSession[];
  links: PullRequestLink[];
  valid(): boolean;
  check(candidate: RetirementCandidate): Promise<RetirementCheck>;
  remove(directory: string): Promise<void>;
  cleaned(candidate: RetirementCandidate): void;
}): Promise<{ removed: number; kept: number }> {
  const linksBySession = new Map<string, PullRequestLink[]>();
  for (const link of input.links)
    linksBySession.set(link.sessionID, [...(linksBySession.get(link.sessionID) ?? []), link]);
  const managed = input.worktrees.filter(
    (tree) => tree.strategy !== null && !isWithinDirectory(input.canonical, tree.directory),
  );
  const candidates = mergedWorktreeCandidates({
    worktrees: managed,
    sessions: input.sessions,
    projectID: input.projectID,
    linksBySession,
  });
  let removed = 0;
  let kept = 0;
  for (const candidate of candidates) {
    if (!input.valid()) break;
    try {
      const check = await input.check(candidate);
      const tasks = attachedTasks(input.sessions, input.projectID, candidate.directory);
      // A failed refresh of any attached link is not evidence that all its PRs settled.
      if (
        !tasks.length ||
        tasks.some((task) => linksBySession.get(task.id)?.some((link) => link.syncError)) ||
        !input.valid() ||
        !canRetire(retirementChecklist(check, candidate.pullRequest))
      ) {
        kept += 1;
        continue;
      }
      await input.remove(candidate.directory);
      removed += 1;
      input.cleaned(candidate);
    } catch {
      // Never retry with force, even when OpenCode reports a late dirty-worktree refusal.
      kept += 1;
    }
  }
  return { removed, kept };
}
