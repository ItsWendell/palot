# @palot/opencode-voice-coordinator

An OpenCode V2 server plugin that turns a session into a voice coordinator. Palot's voice chat
sends the user's spoken requests to that session as `Voice delegation.` prompts. The coordinator
starts task sessions for real coding work, steers them, waits on them, and replies with something
short enough to be read aloud.

It registers:

- the `voice-coordinator` agent (primary and hidden, so it never becomes the default agent), and
- six tools that only that agent can use: `voice_list_projects`, `voice_list_sessions`,
  `voice_create_session`, `voice_send_message`, `voice_read_session`, and `voice_wait_sessions`.

Other agents never see the tools: the plugin removes them from every other agent's model request,
and each tool also rejects calls from any other agent.

`voice_create_session` and `voice_send_message` go through OpenCode's normal permission prompt. The
agent asks by default, and you can allow them in config:

```jsonc
{
  "agents": {
    "voice-coordinator": {
      "permissions": [{ "action": "voice_send_message", "resource": "*", "effect": "allow" }],
    },
  },
}
```

## Enable it

The `plugins` entry in `opencode.jsonc` must point to this package's **directory**. Use an absolute
path, a `file://` URL, or a path starting with `./` or `../`, relative to the config file. OpenCode
loads `server.ts` from that directory.

```jsonc
{
  "plugins": ["/absolute/path/to/palot/packages/opencode-voice-coordinator"],
}
```

To start a coordinator, create a session with `agent: "voice-coordinator"` and send it the voice
delegation prompts.

## How Palot will enable it

Palot will add the package directory to `plugins` and create its voice coordinator session with
`agent: "voice-coordinator"`. In development that directory is this workspace package. Packaged
builds have to ship it as a resource directory and add the bundled path instead. Palot should also
list the user's known project directories in the delegation `context`, because plugins cannot
list projects themselves.

## Limits in OpenCode 2.0.32

- Plugins have no `session.list` and no project list. OpenCode 2.1.0 adds
  `ctx.session.list(...)`, which this package does not use yet. So `voice_list_sessions` only returns task sessions that a voice coordinator
  started, which the plugin keeps in its own storage. `voice_list_projects` combines this
  session's project, that project's worktrees, and the directories of those task sessions.
- Plugins cannot list pending questions (forms) either. Open questions are counted from `question`
  tool calls still running in the session's context. Pending approvals come from
  `permission.list`.

## Development

```sh
bun run --cwd packages/opencode-voice-coordinator check-types
bun run --cwd packages/opencode-voice-coordinator test
```
