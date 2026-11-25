/**
 * A probe for tests: called with a task id each time its row renders, so a test can assert
 * that one task's change re-renders that row and nothing else. Off (one null check) otherwise.
 */
let probe: ((taskID: string) => void) | null = null;

export function setRowRenderProbe(next: ((taskID: string) => void) | null) {
  probe = next;
}

export function countRowRender(taskID: string) {
  probe?.(taskID);
}
