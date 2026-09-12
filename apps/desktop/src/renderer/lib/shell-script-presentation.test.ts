import { describe, expect, it } from "vitest";

import { pythonShellPresentation } from "./shell-script-presentation";

describe("pythonShellPresentation", () => {
  it("extracts a literal heredoc without changing its Python source", () => {
    expect(
      pythonShellPresentation("python3 - <<'PY'\nimport sys\n\nprint('$HOME', sys.version)\nPY"),
    ).toEqual({
      segments: [
        {
          language: "python",
          code: "import sys\n\nprint('$HOME', sys.version)\n",
          invocation: "python3 - <<'PY'",
        },
      ],
      mixed: false,
    });
  });

  it("preserves shell before and after a heredoc, including a semicolon prefix", () => {
    const command =
      "cd /workspace\nasar extract-file app.asar package.json; python3 - <<'PY'\nprint(42)\nPY\nprintf 'done\\n'\n";
    expect(pythonShellPresentation(command)).toEqual({
      segments: [
        { language: "shell", code: "cd /workspace\nasar extract-file app.asar package.json; " },
        { language: "python", code: "print(42)\n", invocation: "python3 - <<'PY'" },
        { language: "shell", code: "printf 'done\\n'\n" },
      ],
      mixed: true,
    });
  });

  it("supports quoted delimiters, versioned executables, and multiple blocks in order", () => {
    expect(
      pythonShellPresentation(
        "python3.13 <<\"END\"\nprint(1)\nEND\necho next\npython -c 'print(2)'",
      ),
    ).toEqual({
      segments: [
        { language: "python", code: "print(1)\n", invocation: 'python3.13 <<"END"' },
        { language: "shell", code: "echo next\n" },
        { language: "python", code: "print(2)", invocation: "python -c 'print(2)'" },
      ],
      mixed: true,
    });
  });

  it("keeps multiline single-quoted -c arguments literal", () => {
    const command = "python -c 'import os\nprint(\"$HOME; `literal` \\\\n\")'";
    expect(pythonShellPresentation(command)?.segments).toEqual([
      {
        language: "python",
        code: 'import os\nprint("$HOME; `literal` \\\\n")',
        invocation: command,
      },
    ]);
  });

  it("decodes only escapes recognized within shell double quotes", () => {
    const command = String.raw`python3 -c "print(\"\$HOME\", '\n', '\\', '\`')"`;
    expect(pythonShellPresentation(command)?.segments).toEqual([
      {
        language: "python",
        code: String.raw`print("$HOME", '\n', '\', '` + "`')",
        invocation: command,
      },
    ]);
  });

  it("does not interpret a quoted shell string as a Python command", () => {
    expect(pythonShellPresentation("echo 'python3 - <<\"PY\"\nprint(1)\nPY'")).toBeNull();
    expect(pythonShellPresentation("echo 'python -c fake'\npython -c 'print(1)'")).toEqual({
      segments: [
        { language: "shell", code: "echo 'python -c fake'\n" },
        { language: "python", code: "print(1)", invocation: "python -c 'print(1)'" },
      ],
      mixed: true,
    });
  });

  it("only terminates a heredoc at an exact delimiter line", () => {
    expect(pythonShellPresentation("python <<'PY'\nPY suffix\n PY\nPY")?.segments[0]?.code).toBe(
      "PY suffix\n PY\n",
    );
    expect(pythonShellPresentation("python <<'PY'\nPY")?.segments[0]?.code).toBe("");
  });

  it.each([
    "echo hello",
    "python script.py",
    "python -c print(1)",
    "python -c \"print('$HOME')\"",
    'python -c "$(cat script.py)"',
    'python -c "`cat script.py`"',
    "python -c 'print(1)' extra",
    "python -c 'print(1)'\"print(2)\"",
    "python -c 'print(1)",
    "python -c 'print(1)' > out",
    "python -u -c 'print(1)'",
    "python <<PY\nprint(1)\nPY",
    "python <<-'PY'\nprint(1)\nPY",
    "python <<'PY' > out\nprint(1)\nPY",
    "python <<'PY'\nprint(1)",
    "python <<'PY'\nprint(1)\n PY",
    "cat <<'OUTER'\npython -c 'print(1)'\nOUTER",
    "cat <<OUTER\npython -c 'print(1)'\nOUTER",
    "echo ready && python -c 'print(1)'",
    "echo ready | python -c 'print(1)'",
    "if true; then\npython -c 'print(1)'\nfi",
    "(\npython -c 'print(1)'\n)",
    "echo $(\npython -c 'print(1)'\n)",
    "echo ready \\\npython -c 'print(1)'",
    "python -c 'print(1)'; echo done",
    "echo ready;python -c 'print(1)'",
    "python -c 'print(1)'\ncat <<'EOF'\nnot closed",
  ])("leaves unsupported or ambiguous syntax raw: %s", (command) => {
    expect(pythonShellPresentation(command)).toBeNull();
  });
});
