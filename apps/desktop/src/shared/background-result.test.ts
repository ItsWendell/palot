import { describe, expect, it } from "vitest";
import { backgroundResultTag, parseBackgroundResult } from "./background-result";

// Texts from OpenCode's own tests, before and after #64971 (2.4.0).
describe("parseBackgroundResult", () => {
  it("reads every 2.4 kind with its attributes", () => {
    expect(
      parseBackgroundResult(
        '<background-result kind="shell" id="call-completed-shell" state="completed" command="exit 7">\nExited with code 7\n</background-result>',
        "shell",
      ),
    ).toMatchObject({
      attributes: { id: "call-completed-shell", state: "completed", command: "exit 7" },
      body: "Exited with code 7",
    });
    expect(
      parseBackgroundResult(
        '<background-result kind="codemode" id="cm_1" state="completed">\nresult: done\n</background-result>',
        "codemode",
      ),
    ).toMatchObject({ attributes: { id: "cm_1", state: "completed" }, body: "result: done" });
    expect(
      parseBackgroundResult(
        '<background-result kind="video" id="vid_1" state="completed">\nVideo request finished. Saved video: /tmp/running.mp4.\n</background-result>',
        "video",
      )?.body,
    ).toBe("Video request finished. Saved video: /tmp/running.mp4.");
  });

  it("still reads the tags from before 2.4", () => {
    expect(
      parseBackgroundResult(
        '<subagent sessionID="child" state="completed" description="Completed inspection">\nAll done\n</subagent>',
        "subagent",
      ),
    ).toMatchObject({ attributes: { sessionID: "child", state: "completed" }, body: "All done" });
    expect(
      parseBackgroundResult('<codemode id="cm_1" state="failed">\nboom\n</codemode>', "codemode")
        ?.body,
    ).toBe("boom");
  });

  it("refuses another kind, a mismatched close and text around the block", () => {
    const shell =
      '<background-result kind="shell" id="s" state="completed" command="ls">\nout\n</background-result>';
    expect(parseBackgroundResult(shell, "codemode")).toBeNull();
    expect(parseBackgroundResult('<shell id="s">\nout\n</background-result>', "shell")).toBeNull();
    expect(parseBackgroundResult(`prefix ${shell}`, "shell")).toBeNull();
    expect(parseBackgroundResult("prefix <shell>literal output</shell>", "shell")).toBeNull();
  });
});

describe("backgroundResultTag", () => {
  it("reads the opening tag of an unfinished text", () => {
    expect(
      backgroundResultTag(
        '<background-result kind="subagent" sessionID="c" state="running" description="d">\nBody',
        "subagent",
      ),
    ).toEqual({
      opening:
        '<background-result kind="subagent" sessionID="c" state="running" description="d">\n',
      attributes: { sessionID: "c", state: "running", description: "d" },
    });
  });
});
