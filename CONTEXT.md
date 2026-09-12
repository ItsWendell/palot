# Palot

Palot presents OpenCode sessions as inspectable streams of user direction, agent work, and delegated subagent work.

## Language

**Work block**:
One uninterrupted period of agent work toward an outcome. It can contain multiple user messages when those messages are steers, but Palot does not reconstruct work-block ownership when OpenCode has not retained it.
_Avoid_: Turn, response

**Timeline row**:
The chronological presentation of native OpenCode messages or session events. Adjacent assistant activity may share one row for readability, but rows preserve source order and do not imply work-block ownership.
_Avoid_: Turn

**Steer**:
User direction incorporated into the active work block. A steer remains its own chronological timeline row; Palot labels it only when OpenCode still provides the delivery state.
_Avoid_: Follow-up turn, inferred owner

**Queued input**:
User direction that waits for the active work block to finish. It remains visible at its chronological admission point and starts a new work block when OpenCode promotes it for execution.
_Avoid_: Steer
