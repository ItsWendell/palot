# UX Improvements for Codedeck

> User experience workflow improvements — how Codedeck could improve the end-to-end experience of working with AI coding agents.

## Workflow Gaps

### 1. No "Review and Act" Workflow for Completed Sessions

**The problem:** When an agent completes its work, there's no structured review flow. Users see the chat history but have no way to:

- View a summary of all changes
- Create a PR from the changes
- Apply changes locally (for cloud agents)
- Request further changes on specific files
- Discard/revert all changes

**OpenCode Desktop's approach:**

- Session review panel with per-file diffs
- Line-level comments that become prompt context
- Turn-level vs session-level diff views

**Recommended UX flow:**

```
Agent completes → Banner appears: "Agent finished. 4 files changed (+142 -23)"
                  [Review Changes] [Create PR] [Continue Working]

Review Changes → Opens review panel with:
  - File list with change summary
  - Per-file unified diffs
  - Inline comment ability (comments fed back to agent)
  - "Looks good" / "Needs changes" per file
  - Global "Accept All" / "Request Revision"
```

### 2. No Context Overflow Handling

**The problem:** When an agent's context window fills up, there's no user-visible indication or automatic handling.

**OpenCode's approach:**

- Auto-compaction: When context overflows, a compaction agent summarizes the conversation
- `/compact` manual trigger
- Context usage shown as percentage in the header
- Old tool outputs are pruned automatically

**Recommended UX:**

- Show context usage meter (percentage of context window used)
- Warning at 80%: "Context window 80% full. Consider compacting."
- Auto-compact trigger at 95% (configurable)
- "Compact now" button in the context meter dropdown
- Show compaction summary when it happens

### 3. No Error Recovery UX

**The problem:** When an agent fails or makes a mistake, the only option is to send a follow-up message. There's no structured error recovery.

**OpenCode's approach:**

- `/undo` reverts the last message AND restores file changes via git snapshots
- `/redo` restores the reverted state
- `/fork` creates a new session from any point in the conversation

**Recommended UX:**

- Add "Undo last turn" button (appears on hover over the last turn)
- Add "Fork from here" context menu on any turn
- Show a "Retry" button on failed turns (resends the last user message)
- Add "Revert all file changes" action for sessions with unwanted edits

### 4. No Prompt Engineering Assistance

**The problem:** Users type prompts in a plain textarea with no assistance.

**OpenCode's approach:**

- `@file.ts` mentions add file content as context
- `@file.ts#10-20` adds specific line ranges
- `/commands` for common operations
- Suggestion prompts on home screen (Codedeck has these)
- External editor support for complex prompts

**Recommended UX additions:**

- **`@` file mentions**: Type `@` to fuzzy-search project files, insert as context
- **Slash commands**: Type `/` for common operations (compact, fork, undo, etc.)
- **Prompt templates**: Save and reuse common prompt patterns
- **Context pills**: Show attached files/mentions as removable pills above the textarea
- **Recent prompts**: Press Up arrow to cycle through previous prompts

### 5. No Multi-Agent Coordination View

**The problem:** When multiple agents are running across projects, there's no overview of what's happening globally.

**Codedeck's DESIGN.md envisions this but it's not implemented:**

**Recommended UX:**

- **Activity feed**: A unified timeline of events across all active agents
- **Resource overview**: Total tokens used, total cost, active agent count
- **Attention required**: Surface permissions/questions/failures from any project
- **Bulk actions**: Stop all, compact all, archive completed

### 6. No Workspace/Branch Awareness in UI

**The problem:** The UI shows projects but doesn't show git branch context prominently.

**Current state:** VCS branch is shown in the status bar below the prompt input, but not in the sidebar or session list.

**Recommended UX:**

- Show branch name on each project in the sidebar
- Show branch name on each session in the sidebar
- Highlight when a session's branch has diverged from main
- Show PR status if a PR exists for the session's branch
- Add "Create PR" action to completed sessions

## Interaction Pattern Improvements

### 7. Improve Permission Request Flow

**Current state:** Permissions show as a card above the prompt with "Allow" / "Deny" buttons and an "Always allow" dropdown option.

**Missing from OpenCode's permission UX:**

- **Diff preview**: See what file changes will be made before approving
- **Reject with feedback**: When denying, provide guidance ("Don't modify that file, use X instead")
- **Batch approval**: "Allow all pending" for sessions with many queued permissions
- **Permission history**: See what was previously approved/denied in this session

**Recommended improvements:**

- Add diff content to file edit permissions (critical)
- Add a text input that appears when clicking "Deny" for feedback
- Show bash command preview for shell permissions
- Group related permissions (multiple file edits from one operation)

### 8. Improve Question Response Flow

**Current state:** `ChatQuestionCard` shows questions with selectable options and a text input for custom answers.

**Missing:**

- **Multi-question forms**: Questions with multiple sub-questions should be tabbed
- **Image-based questions**: Some questions reference code/files that should be visible
- **Question context**: Show what the agent was doing when it asked the question

**Recommended improvements:**

- Show the agent's "thinking" context above the question
- Add a "Skip" option (reject with auto-continue)
- Remember common answers for similar questions

### 9. Add Session Lifecycle State Machine

**Current state:** Sessions have statuses (running, waiting, idle, completed, failed) but no explicit lifecycle management.

**Recommended UX additions:**

- **Pause/Resume**: Explicitly pause an agent without aborting
- **Retry**: Re-run the last prompt after a failure
- **Archive**: Move completed sessions out of the main view
- **Pin**: Keep important sessions at the top regardless of activity
- **Star/Bookmark**: Mark sessions for later reference

### 10. Improve New Chat Experience

**Current state:** `NewChat` has a "Let's build" hero, project picker, 3 suggestion cards, and a prompt input.

**Recommended improvements:**

- **Recent prompts**: Show last 3-5 prompts used across projects
- **Project-specific suggestions**: Tailor suggestions based on the project type
- **Template gallery**: Pre-built prompt templates for common tasks (bug fix, feature, refactor, test, docs)
- **Quick actions**: "Review recent changes", "Continue last session", "Run tests"
- **Auto-detect intent**: If user types a file path, auto-suggest attaching it

## Performance Perception

### 11. Improve Perceived Responsiveness

**Current state:** Good streaming performance but some visual gaps.

**Recommended improvements:**

- **Skeleton loading**: Show message skeletons while loading chat history
- **Streaming cursor**: Show a blinking cursor or typing indicator while the AI is generating
- **Optimistic navigation**: When clicking a session, show the session view immediately with cached data while fresh data loads
- **Pre-fetch adjacent sessions**: Load messages for the next/previous session in the sidebar
- **Transition animations**: Add subtle slide/fade animations for panel transitions

### 12. Add Progress Indicators for Long Operations

**Current state:** "Working..." shimmer text during agent activity.

**Recommended improvements:**

- Show tool-specific status messages (already partially done in `computeStatus`)
- Add a progress bar for multi-step operations (based on todo items)
- Show estimated time remaining based on similar past sessions
- Animate the session item in the sidebar while active (pulse, subtle glow)
