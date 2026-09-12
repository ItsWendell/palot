import { screen } from "@testing-library/react";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { renderWithRouter } from "../test-utils/render-with-router";
import { PostFinalItems } from "./thread";

describe("PostFinalItems", () => {
  it("renders produced resources without workspace working changes", () => {
    renderWithRouter(
      <PostFinalItems
        items={[
          {
            id: "diff:src/app.tsx",
            kind: "diff",
            name: "src/app.tsx",
            patch: "@@ -1 +1 @@\n-old\n+new",
            additions: 1,
            deletions: 1,
          },
          {
            id: "file:report.txt",
            kind: "file",
            name: "report.txt",
          },
        ]}
      />,
      createStore(),
      "/",
    );

    expect(screen.getByText("report.txt")).toBeTruthy();
    expect(screen.queryByText("Working changes")).toBeNull();
    expect(screen.queryByText("src/app.tsx")).toBeNull();
  });
});
