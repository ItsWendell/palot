// Loaded only by the hosts scenario. All host traffic is fake, Git traffic uses a local bare repo.
require("./github.cjs");
const fs = require("node:fs");
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== "gitlab.example") return original(input, init);
  const file = process.env.PALOT_TEST_GITLAB_STATE;
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  const body = init?.body ? JSON.parse(init.body) : {};
  const method = init?.method ?? "GET";
  if (init?.headers?.authorization !== "Bearer palot-e2e-gitlab-token")
    throw new Error("Missing fixture token");
  fs.appendFileSync(
    `${file}.requests.jsonl`,
    JSON.stringify({ path: url.pathname, method, body }) + "\n",
  );
  const row = () => ({
    iid: 7,
    project_id: 1,
    title: state.title ?? "Fixture MR",
    description: state.description ?? "Fixture description",
    web_url: "https://gitlab.example/group/sub/fixture/-/merge_requests/7",
    references: { full: "group/sub/fixture!7" },
    state: state.merged ? "merged" : "opened",
    source_branch: "feature",
    target_branch: "main",
    sha: state.sha,
    author: { id: 2, username: "author" },
    detailed_merge_status: "mergeable",
    created_at: "2026-10-28T10:00:00Z",
    updated_at: "2026-10-28T12:00:00Z",
    merged_at: state.merged ? "2026-10-28T12:00:00Z" : null,
    head_pipeline: {
      id: 42,
      sha: state.sha,
      status: "success",
      web_url: "https://gitlab.example/group/sub/fixture/-/pipelines/42",
    },
  });
  let data;
  if (url.pathname === "/api/v4/user") data = { id: 1, username: "viewer" };
  else if (url.pathname.endsWith("/merge_requests") && method === "POST") {
    Object.assign(state, body, { created: true });
    data = row();
  } else if (url.pathname.endsWith("/merge") && method === "PUT") {
    if (body.sha !== state.sha) return Response.json({}, { status: 409 });
    state.merged = true;
    data = row();
  } else if (url.pathname.endsWith("/merge_requests"))
    data =
      state.created &&
      (!url.searchParams.has("state") ||
        url.searchParams.get("state") !== "opened" ||
        !state.merged)
        ? [row()]
        : [];
  else if (url.pathname.endsWith("/merge_requests/7")) data = row();
  else if (url.pathname.endsWith("/notes") || url.pathname.endsWith("/diffs")) data = [];
  else if (url.pathname === "/api/v4/projects/group%2Fsub%2Ffixture")
    data = { default_branch: "main" };
  else throw new Error(`Unexpected fake GitLab request: ${method} ${url.pathname}`);
  fs.writeFileSync(file, JSON.stringify(state));
  return Response.json(data);
};
