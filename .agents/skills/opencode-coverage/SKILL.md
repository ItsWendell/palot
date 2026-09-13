---
name: opencode-coverage
description: Audit Palot's OpenCode 2 operation and event coverage, analyzer or baseline regressions, published contract-surface deltas, or reviewed baseline updates. Ordinary event-handler fixes do not need this audit. Use opencode-runtime for release selection and runtime version alignment.
---

# OpenCode coverage

Use the deterministic analyzer as the source of facts. Your job is to interpret its evidence, trace important gaps, and recommend work.

Match the audit to the requested scope. For a specific operation, event, or regression, inspect its diagnostics and relevant evidence rather than producing a repository-wide inventory. Loading this skill does not authorize baseline changes or runtime upgrades.

## Run the audit

Start with the pinned offline check:

```sh
bun run opencode:coverage:check
```

For published V2 changes:

```sh
bun run opencode:coverage --compare beta,dev
```

Read the repository-root `../../../.local/opencode-coverage/report.json`. Use the Markdown report only for a quick overview.

The analyzer owns:

- The exact installed OpenAPI inventory from `@opencode/protocol/client`.
- Promise-client path mapping, including experimental and custom-transport operations.
- Oxc AST references in production, unit tests, and deterministic E2E code.
- Request fields passed by Palot and response paths read by Palot.
- The exact generated `OpenCodeEvent` union and string-literal evidence.
- Contract and evidence regressions against repository-root `../../../apps/desktop/opencode-coverage-baseline.json`.

## Interpret an operation

Trace evidence in this order:

1. Contract: method, path, stability, request fields, and Promise-client availability.
2. Transport: generated Promise client, SSE, or a custom transport such as PTY WebSocket.
3. Production: every location in `evidence.locations` whose kind is `production`.
4. Breadth: compare `requestFieldsObserved` with `inputFields`; inspect `responsePathsObserved`. If `observedRequestCoverage.complete` is false, report unresolved analysis instead of treating missing fields as unused.
5. Product path: follow the adapter into Palot contracts, state, hooks, and visible behavior.
6. Tests: separate mocks, direct unit calls, and deterministic E2E references.
7. Failure behavior: cancellation, errors, reconnect, stale state, and cleanup.

Assign one interpretation after tracing:

- `absent`: no Palot behavior uses it.
- `transport-only`: reachable through Palot's generic transport but has no product integration.
- `partial`: Palot uses the operation but leaves meaningful request, response, or state behavior unused.
- `workflow`: a user or automation workflow depends on it.
- `deep`: the workflow handles expected fields, failures, cancellation or reconnect where applicable, and has durable tests.
- `intentional`: omission is correct for Palot, such as a migration or debug endpoint without a product need.

State evidence for the label. A production reference alone does not prove `workflow` or `deep`.

## Review new upstream work

Treat the exact published packages as authoritative. Stable is Palot's default update target; use Beta when requested. A published npm channel is not the OpenCode repository branch of the same name. Source-only work is a watch item until a supported publish contains it. Load `opencode-runtime` before comparing channels or recommending an update.

Prioritize findings in this order:

1. Breaking changes to operations Palot uses.
2. New event variants that can corrupt or stale Palot state.
3. New operations that replace Palot workarounds or unlock requested product behavior.
4. Integrated operations with no direct test evidence.
5. Intentional omissions and low-value inventory gaps.

## Baseline changes

Run the audit first and inspect every issue, added, removed, or changed operation, and event. The JSON comparison includes complete current and candidate operation records. Then pass the exact contract fingerprint shown in the report:

```sh
bun run opencode:coverage --update-baseline --reviewed <contract-fingerprint>
```

The command preserves the pre-update report under `.local/opencode-coverage/review-before-update.*`. Preserve manual `disposition` and `note` entries. A lost integration needs a fix or an explicit reviewed disposition, not a blind baseline update.

## Output

For a focused investigation, report the relevant contract status, evidence, finding, and next step. For a full coverage audit, report:

- Pinned contract status.
- Latest beta and dev deltas when requested.
- Coverage by group.
- Experimental operations.
- The highest-risk absent and partial integrations.
- Weak test and event evidence.
- Concrete next changes with file references.

Keep raw collection out of the prose. Link to the JSON report for exhaustive data.

The investigation is complete when the requested scope is accounted for, the pinned check result and relevant unresolved diagnostics are disclosed, every assigned `partial` or `deep` label cites production and product-path evidence, and each high-priority gap in scope has a concrete next step. A failing check is a finding to explain, not permission to repair unrelated integrations or reset the baseline.
