# Source control

Palot chooses the code host from a repository's Git remote URL. GitHub stays
available through `gh` or its environment variables. Add other hosts in
**Settings → Source control**, then choose the host in **Pull requests**.

Only HTTPS API roots are supported, such as `https://gitlab.com` or
`https://forge.example.com`. Installations under a URL subpath are not supported.
Git remotes can use HTTPS, SSH URLs or SCP-style addresses. GitLab nested groups
are supported. Unknown hosts must be configured before Palot sends API requests.

## Host support

| Operation                                  | GitHub                                                                                   | GitLab.com / self-hosted                                                 | Forgejo / Gitea                                      | Bitbucket Cloud                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------ |
| List                                       | Existing lists and filters, plus open by others in a filtered repository or organization | Authored, assigned, review requested, recently merged; plain-text search | Authored, assigned, review requested                 | Repository list using `repo:workspace/repository`            |
| Detail, create, comment, link and watch    | Yes                                                                                      | Yes                                                                      | Yes                                                  | Yes                                                          |
| Checks                                     | Existing checks/statuses                                                                 | Head pipeline                                                            | Commit statuses                                      | Commit build statuses, including published pipeline statuses |
| Approve                                    | Yes                                                                                      | Yes, at the reviewed SHA                                                 | Yes                                                  | Yes                                                          |
| Request changes                            | Yes                                                                                      | Leave a comment instead                                                  | Yes                                                  | Leave a comment instead                                      |
| Merge                                      | Existing methods                                                                         | Merge commit or squash, pinned to the displayed SHA                      | Merge, squash or rebase, pinned to the displayed SHA | Disabled: no atomic expected-head API precondition           |
| Auto-merge                                 | Yes                                                                                      | Merge when pipeline succeeds                                             | No                                                   | No                                                           |
| Edit title/body, drafts, close/reopen      | Yes                                                                                      | Yes                                                                      | No                                                   | No                                                           |
| Changed files                              | Existing diff review                                                                     | Patches where GitLab supplies them                                       | Patches where the host supplies them                 | File list and counts, open the host for patches              |
| Inline review, viewed files, review guide  | Yes                                                                                      | No                                                                       | No                                                   | No                                                           |
| Labels, reviewer management, update branch | Yes                                                                                      | No                                                                       | No                                                   | No                                                           |

Unsupported actions are disabled with a reason. Bitbucket merge stays disabled
because a read-before-merge check could merge commits you haven't seen if the
branch changes between requests. Merge on Bitbucket instead.

GitLab checks represent the MR's head pipeline, not every job or project approval
rule. Project requirements remain enforced by GitLab when merging. Empty or
partial status responses are not treated as complete passing checks. Large lists,
timelines and changed-file responses are bounded; incomplete watch baselines do
not generate an all-clear notification. Forgejo and Bitbucket watch one
comment page (up to 100); additional pages require opening the host. A watch sends host
comments/check changes through the linked task's model, so treat host content as
untrusted input.

## Credentials

Saved tokens use Palot's existing encrypted credential vault. The host URL and
provider type are ordinary local settings; the secret is not. A new token replaces
the saved token for that exact host. Remove deletes the saved token, not the
provider-side credential. Environment credentials and CLI sign-ins can still apply.

| Provider        | Environment fallback                                                                                                             | Permissions                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GitHub          | `GH_TOKEN` / `GITHUB_TOKEN`, then `gh auth token`; `GH_HOST` selects Enterprise                                                  | Existing GitHub repository/PR permissions                                                                                          |
| GitLab          | `GITLAB_TOKEN` / `GL_TOKEN`, then `glab auth token --hostname`; `GITLAB_HOST` / `GL_HOST` selects the host, default `gitlab.com` | Personal/project token with `api`, and access to the project; approval/merge also needs the corresponding role                     |
| Forgejo / Gitea | `FORGEJO_TOKEN` / `GITEA_TOKEN`; `FORGEJO_HOST` selects the host, default `codeberg.org`                                         | Repository read/write, issue/PR read/write and user read access, according to the server's token-scope model                       |
| Bitbucket Cloud | `BITBUCKET_TOKEN`, for `bitbucket.org` only                                                                                      | Bearer access token with repository and pull-request read/write permissions; Basic-auth app passwords/API tokens are not supported |

A saved token takes precedence over environment and CLI tokens. Tokens are never
sent to a different host after a redirect. Code-host API calls run on the desktop,
not the task's server. Desktop tokens do not authenticate Git pushes or pulls:
configure Git's credentials on the machine where Git runs.

## Git on remote tasks

Status, staging, unstaging, commits, push/pull/sync and branch operations work on
local connections and remote OpenCode 2.2 servers exposing the public shell API.
SSH profiles use that API through their existing SSH tunnel. Other remote
profiles use their configured HTTP connection. No commands are hidden in the
agent's transcript and no alternate SSH process or agent turn is needed.

Remote Git currently needs a POSIX server with `git`, `sh`, `mktemp`, `base64` and
`tr`. Interactive Git authentication is disabled. Configure SSH keys or a
non-interactive Git credential helper on that server. Normal Git hooks run under
the server account. Palot preserves the existing dirty-tree, divergent-pull,
default-branch confirmation and expected-head protections. It never runs a remote
directory against desktop Git as a fallback.

OpenCode 2.2's VCS routes are read-oriented and do not offer stage/commit/push
operations. The public `shell.create/get/output/remove` API is the supported
non-transcript execution path. Older servers without it cannot perform these Git
actions; update the server or use a local connection. Windows remote shells and
subpath-hosted code-host APIs remain unsupported.

See [Privacy](../PRIVACY.md#source-control) for data flow, hook execution and
server-side cleanup limitations.
