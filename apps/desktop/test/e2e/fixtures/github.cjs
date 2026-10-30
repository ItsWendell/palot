// Loaded only by fake-GitHub E2E scenarios through NODE_OPTIONS, never by production code.
// Intercept GitHub before the main process starts. All GitHub calls stay in this fixture.
const fs = require("node:fs");
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
  if (url.hostname !== "api.github.com") return original(input, init);
  const statePath = process.env.PALOT_TEST_GITHUB_STATE;
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const body = init?.body ? JSON.parse(init.body) : {};
  if (body.query?.includes("mutation PalotEnableAutoMerge"))
    state.autoMerge = body.variables.method;
  if (body.query?.includes("mutation PalotDisableAutoMerge")) state.autoMerge = null;
  if (init?.method === "PATCH" && url.pathname.endsWith("/pulls/7")) Object.assign(state, body);
  fs.writeFileSync(statePath, JSON.stringify(state));
  fs.appendFileSync(
    `${statePath}.requests.jsonl`,
    JSON.stringify({ path: url.pathname, method: init?.method ?? "GET", body }) + "\n",
  );
  const node = {
    id: "PR_7",
    number: 7,
    title: state.title ?? "Fixture PR",
    url: "https://github.com/palot-e2e/fixture/pull/7",
    state: state.merged ? "MERGED" : "OPEN",
    isDraft: state.draft ?? false,
    updatedAt: "2026-10-28T12:00:00Z",
    mergedAt: state.merged ? "2026-10-28T12:00:00Z" : null,
    closedAt: null,
    headRefName: "feature",
    baseRefName: "main",
    headRefOid: state.oid ?? "a".repeat(40),
    body: state.body ?? "Fixture description",
    createdAt: "2026-10-28T10:00:00Z",
    viewerCanUpdate: true,
    viewerDidAuthor: true,
    mergeStateStatus: "BLOCKED",
    autoMergeRequest: state.autoMerge ? { mergeMethod: state.autoMerge } : null,
    labels: { nodes: [] },
    files: { nodes: [], pageInfo: { hasNextPage: false } },
    changedFiles: 0,
    mergeable: "MERGEABLE",
    author: { login: "fixture" },
    repository: { nameWithOwner: "palot-e2e/fixture" },
    commits: {
      nodes: [
        {
          commit: {
            oid: "a".repeat(40),
            statusCheckRollup: {
              state: state.checkStatus === "FAILURE" ? "FAILURE" : "SUCCESS",
              contexts: {
                nodes: state.checkStatus
                  ? [
                      {
                        __typename: "CheckRun",
                        name: "Fixture CI",
                        status: state.checkStatus === "PENDING" ? "IN_PROGRESS" : "COMPLETED",
                        conclusion:
                          state.checkStatus === "FAILURE"
                            ? "FAILURE"
                            : state.checkStatus === "SUCCESS"
                              ? "SUCCESS"
                              : null,
                        detailsUrl: "https://github.com/palot-e2e/fixture/actions/runs/1",
                        isRequired: true,
                      },
                    ]
                  : [],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        },
      ],
    },
    comments: { nodes: [], pageInfo: { hasNextPage: false } },
    reviews: { nodes: [], pageInfo: { hasNextPage: false } },
    reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
  };
  let data;
  if (url.pathname === "/graphql") {
    const answer = { viewer: { login: "fixture" } };
    answer.repository = {
      autoMergeAllowed: true,
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      viewerPermission: "WRITE",
      viewerDefaultMergeMethod: "SQUASH",
      pullRequest: state.created ? node : null,
    };
    answer.search = {
      nodes: state.created ? [node] : [],
      issueCount: state.created ? 1 : 0,
      pageInfo: { hasNextPage: false },
    };
    for (const match of (body.query ?? "").matchAll(/pr(\d+): repository/g))
      answer[`pr${match[1]}`] = {
        pullRequest: state.created ? node : null,
        ...(body.query.includes("watch: pullRequest")
          ? { watch: state.created ? node : null }
          : {}),
      };
    data = { data: answer };
  } else if (url.pathname.endsWith("/pulls/7") && init?.method === "PATCH") data = node;
  else if (url.pathname.endsWith("/files")) data = [];
  else if (url.pathname.endsWith("/labels")) data = [];
  else if (url.pathname.endsWith("/pulls") && init?.method === "POST") {
    Object.assign(state, body, { created: true });
    fs.writeFileSync(statePath, JSON.stringify(state));
    data = { number: 7 };
  } else if (url.pathname.endsWith("/pulls"))
    data = state.created ? [{ number: 7, state: "open" }] : [];
  else if (url.pathname === "/repos/palot-e2e/fixture") data = { default_branch: "main" };
  else throw new Error(`Unexpected fake GitHub request: ${url.pathname}`);
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
