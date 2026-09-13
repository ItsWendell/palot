# OpenCode Test LLM

`test-llm-server.ts` is a small Node adaptation of OpenCode's MIT-licensed test utilities.

- Repository: `anomalyco/opencode`
- Commit: `ba72a6ff2b62aaf614b8e745193e86a51be6142c`
- Sources: `packages/opencode/test/lib/llm-server.ts` and `test-provider.ts`
- License: MIT, preserved in `LICENSE.opencode`

Keep the adapter aligned with the exact `@opencode/client` version declared by Palot. Recheck the upstream helpers whenever that version changes.

The `0.0.0-beta-17898` release was audited at V2 commit `75efc9d83325392948763aa2b7a282f3a13e0013`. Those original helper paths no longer exist on the V2 branch. The adapter remains intentionally small and is verified against the release through Palot's deterministic E2E scenarios.

The published `0.0.0-beta-19086` CLI, client, protocol, and schema packages were reconciled together. The isolated LLM adapter did not require protocol changes; the desktop scenarios now exercise the release's persistent PTY contract directly.

The `0.0.0-beta-19271` upgrade kept the adapter's Chat Completions and Responses fixtures without protocol changes. Native worktree coverage adopted the location-scoped API and server-selected destination. The compaction/steer scenario checks both canonical history and the model requests, so a summary cannot silently absorb pending instructions.

Palot moved client, protocol, and provider package references to the `@opencode` scope with `0.0.0-beta-19296`. The adapter fixtures were unchanged; isolated `smoke`, `worktree-lifecycle`, and `model-provider-identity` E2E scenarios passed using that bundled runtime.

Palot previously targeted `0.0.0-beta-19365`. Isolated `smoke`, `worktree-lifecycle`, and `compaction-pending-steer` E2E scenarios passed using bundled `@opencode/cli-darwin-arm64@0.0.0-beta-19365`. The compaction scenario no longer asserts upstream prompt wording; it still checks pending-steer retention, message order, context, and continuation.

Automatic title replies recognize the beta's title-generator system instruction without treating user messages that quote it as title requests. Title requests remain in the captured request log but do not consume scripted responses.

Palot's Node adapter cancels delayed SSE writes on disconnect or shutdown and awaits active request handlers before `close()` returns. Restarting preserves queued scripts and request history.

The `0.0.0-beta-19381` upgrade leaves the adapter unchanged. Published client, protocol, and schema code is identical to `19365`; the isolated native `smoke` scenario passed against the exact `19381` runtime.

The `0.0.0-beta-19425` upgrade also leaves the adapter unchanged. Isolated native `transcript-rail` and `compaction-pending-steer` scenarios passed against the exact runtime. They verify filtered prompt pagination without fetching transcript history, selection of unloaded prompts, and compaction request usage alongside pending-steer retention and continuation.

The stable `2.0.3` upgrade leaves the adapter unchanged. Linux packaged `smoke`,
`composer-draft-switch`, `markdown-rich`, and visible `diagnostics` scenarios passed
against an isolated exact `2.0.3` runtime. The runtime was supplied externally;
the package does not bundle it, and these checks did not replace the shared service.
