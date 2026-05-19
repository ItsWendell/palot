---
version: 1
updatedAt: 2026-05-17T19:35:17.496Z
---

# Agent Performance

| Agent | Team | Runs | Success | Score | Time | Cost | Needs Work |
|---|---:|---:|---:|---:|---:|---:|---:|
| Reviewer | unassigned | 1 | 0% | 55 | 0m | $0.0000 | no |
| React Specialist | engineering | 1 | 0% | 55 | 0m | $0.0000 | no |

## Data

```json
{
  "version": 1,
  "records": [
    {
      "sessionId": "ses_1c8907537ffekZuxoG1iKyeq10",
      "parentSessionId": "ses_1c8910d60ffe3BYME2SqBVRkYY",
      "agentName": "Reviewer",
      "model": null,
      "status": "failed",
      "startedAt": "2026-05-17T19:35:17.496Z",
      "completedAt": "2026-05-17T19:35:17.496Z",
      "durationMs": 0,
      "costUsd": 0,
      "tokens": 0,
      "toolCallCount": 0,
      "errorCount": 0,
      "retryCount": 0,
      "summary": "Agent Reviewer completed.",
      "failureReason": "UnknownError: Agent not found: \"code-reviewer\". Available agents: lead-agent, architect, build, builder, explore, general, plan, reviewer, spec-writer",
      "id": "ses_1c8907537ffekZuxoG1iKyeq10-2026-05-17T19:35:17.496Z",
      "score": 55,
      "createdAt": "2026-05-17T19:35:17.496Z"
    },
    {
      "sessionId": "ses_1c890756fffeAntky4gwZuFoNF",
      "parentSessionId": "ses_1c8910d60ffe3BYME2SqBVRkYY",
      "agentName": "React Specialist",
      "team": "engineering",
      "teamRole": "member",
      "model": null,
      "status": "failed",
      "startedAt": "2026-05-17T19:35:17.451Z",
      "completedAt": "2026-05-17T19:35:17.451Z",
      "durationMs": 0,
      "costUsd": 0,
      "tokens": 0,
      "toolCallCount": 0,
      "errorCount": 0,
      "retryCount": 0,
      "summary": "Agent React Specialist completed.",
      "failureReason": "UnknownError: Agent not found: \"react-specialist\". Available agents: lead-agent, architect, build, builder, explore, general, plan, reviewer, spec-writer",
      "id": "ses_1c890756fffeAntky4gwZuFoNF-2026-05-17T19:35:17.451Z",
      "score": 55,
      "createdAt": "2026-05-17T19:35:17.453Z"
    }
  ],
  "agents": [
    {
      "agentName": "Reviewer",
      "model": null,
      "runs": 1,
      "completed": 0,
      "failed": 1,
      "successRate": 0,
      "avgScore": 55,
      "avgDurationMs": 0,
      "totalDurationMs": 0,
      "totalCostUsd": 0,
      "totalTokens": 0,
      "totalToolCalls": 0,
      "totalErrors": 0,
      "lastRunAt": "2026-05-17T19:35:17.496Z",
      "needsAttention": false
    },
    {
      "agentName": "React Specialist",
      "team": "engineering",
      "teamRole": "member",
      "model": null,
      "runs": 1,
      "completed": 0,
      "failed": 1,
      "successRate": 0,
      "avgScore": 55,
      "avgDurationMs": 0,
      "totalDurationMs": 0,
      "totalCostUsd": 0,
      "totalTokens": 0,
      "totalToolCalls": 0,
      "totalErrors": 0,
      "lastRunAt": "2026-05-17T19:35:17.451Z",
      "needsAttention": false
    }
  ],
  "teams": [
    {
      "team": "unassigned",
      "runs": 1,
      "successRate": 0,
      "avgScore": 55,
      "totalDurationMs": 0,
      "totalCostUsd": 0,
      "needsAttention": false
    },
    {
      "team": "engineering",
      "runs": 1,
      "successRate": 0,
      "avgScore": 55,
      "totalDurationMs": 0,
      "totalCostUsd": 0,
      "needsAttention": false
    }
  ],
  "models": [
    {
      "model": "unknown",
      "runs": 2,
      "successRate": 0,
      "avgScore": 55,
      "totalCostUsd": 0,
      "totalTokens": 0,
      "avgCostPerRun": 0
    }
  ],
  "updatedAt": "2026-05-17T19:35:17.496Z"
}
```