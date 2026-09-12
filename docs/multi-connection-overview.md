# Multi-connection overview

When more than one connection is configured, Inbox and Projects can show tasks
from several servers without changing the active workspace.

## Using the overview

1. Add connections in Settings → Connections.
2. Open **Inbox options → Connections** and enable **Monitor** for the
   connections you want to follow. The focused connection is always monitored.
3. Use **Filter tasks → Servers** to narrow the list without disconnecting a
   server. With no server filter applied, all monitored connections are visible.
4. Open any task to focus its owning connection without reloading the window.

Session rows retain their right-click actions and drag-out-to-new-window gesture in
Inbox, compact shelves, and Projects. Opening a background task in another window
keeps the source window on its current task and connection. Each action uses the
row's owning connection; disconnected rows never fall back to the focused server.

Remote rows have a green cloud and connection name; disconnected connections
are muted. Projects with identical names remain separate per connection. The
composer shows remote destinations as a compact cloud badge beside its project/branch
controls. Connected local destinations are hidden; offline destinations show an
explicit warning in the same context bar.

Inbox retains its larger, multi-line task cards with project/status, title, and
branch or location context. Connection identity is added to those cards. Snoozed
and Settled retain their original compact shelves; Projects also uses compact
task rows. The original filter/view toolbar and collapsible section controls are
shared by single- and multi-connection views. Empty Pinned and Snoozed sections
stay hidden. Loading older tasks and connection management live in the options
menu rather than permanent per-server footer rows.

Projects have the same right-aligned collapsible headers. Expansion is remembered
per connection and project, so collapsing one server's checkout does not collapse
another server's project with the same ID. Inbox chevrons share the rich cards'
timestamp edge; the project new-task action remains separate from the toggle.

Monitoring preferences persist. Turning off monitoring stops that background
connection; merely hiding it does not. Offline connections retain their cached
summary rows, with mutations disabled and an explicit retry action. These cached
summaries are in-memory, not a durable offline replica.

Inbox ordering, attention filters, pinning, settling, snoozing, search, and
pagination work across the included connections. Actions always target the
row's owner, not whichever connection happens to be focused when they finish.

## Performance and ownership

- Each monitored profile retains its own runtime, event stream, client, query
  namespace, and attention index. Lifecycle generations reject stale requests.
- Background hydration loads session/project/activity/request summaries, not
  conversation messages. Background message events do not reduce transcripts.
  Opening or explicitly preloading a task can fetch its transcript on demand.
- Branch metadata is requested only for mounted rich cards and is keyed by both
  connection and directory, so identical paths on different servers cannot mix.
- Summary projection is coalesced and reuses unchanged object identities.
  Registry refreshes do not rehydrate healthy connections. Sidebar rows are
  progressively disclosed rather than mounting every loaded session at once.
- Per-connection request queues bound ordinary requests and Git reads separately.
- Navigation includes the profile ID. Optimistic messages, running shells,
  composer drafts and attachments are profile-scoped, including when two servers
  use the same session ID.
- Native filesystem, terminal, and external-open operations require a captured
  focused connection ID and fail closed if ownership changes.

OpenCode currently does not expose a summary-only event subscription. Background
streams can therefore still carry message payloads over the network; Palot avoids
their transcript processing, but does not claim to eliminate that bandwidth.
Logical linking of equivalent projects on different servers is not implemented.

## Verification

The `multi-connection` native E2E scenario starts two isolated real services and
checks duplicate IDs, cross-server navigation without reload, owner-targeted
background mutations, live updates, and offline isolation. A test-only loopback
proxy supplies the second service's authentication without depending on a
desktop credential vault or changing product credential storage.
