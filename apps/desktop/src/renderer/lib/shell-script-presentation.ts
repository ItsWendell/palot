type Segment = { language: "shell" | "python"; code: string; invocation?: string };

const python = "python(?:3(?:\\.\\d+)?)?";
const heredoc = new RegExp(
  `^[ \\t]*${python}[ \\t]+(?:-[ \\t]+)?<<[ \\t]*(['"])([A-Za-z_][A-Za-z0-9_]*)\\1[ \\t]*$`,
);
const inline = new RegExp(`^[ \\t]*${python}[ \\t]+-c[ \\t]+(['"])([\\s\\S]*)\\1[ \\t]*$`);

/** Locate only top-level line/semicolon boundaries, never text inside quoted shell words. */
function statementEnd(command: string, start: number): number | null {
  let quote = "";
  for (let index = start; index < command.length; index++) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'") quote = "";
    } else if (char === "\\") {
      if (index + 1 === command.length || command[index + 1] === "\n") return null;
      index++;
    } else if (quote === '"') {
      if (char === '"') quote = "";
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "\n" || char === ";") {
      return index;
    }
  }
  return quote ? null : command.length;
}

function literalArgument(quote: string, value: string): string | null {
  if (quote === "'") return value.includes("'") ? null : value;
  let result = "";
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === "$" || char === "`" || char === '"') return null;
    if (char === "\\") {
      const next = value[index + 1];
      if (next === undefined) return null;
      if ('"$`\\'.includes(next)) {
        result += next;
        index++;
        continue;
      }
      // Shell double quotes retain backslashes before all other characters.
    }
    result += char;
  }
  return result;
}

/** Surrounding shell is deliberately restricted to simple, literal commands. */
function simpleShell(statement: string): boolean {
  let quote = "";
  let unquoted = "";
  for (let index = 0; index < statement.length; index++) {
    const char = statement[index]!;
    if (quote === "'") {
      if (char === "'") quote = "";
      continue;
    }
    if (char === "\\") return false;
    if (char === "$" || char === "`") return false;
    if (quote === '"') {
      if (char === '"') quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      unquoted += "word";
    } else {
      if ("|&()<>{}#".includes(char)) return false;
      unquoted += char;
    }
  }
  const first = unquoted.trim().split(/\s+/)[0];
  return !/^(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|function|select|time|coproc|!|python(?:\d.*)?)$/.test(
    first ?? "",
  );
}

/** A display-only parser. Unsupported or ambiguous shell stays entirely raw. */
export function pythonShellPresentation(
  command: string,
): { segments: Segment[]; mixed: boolean } | null {
  const segments: Segment[] = [];
  let offset = 0;
  let shellStart = 0;
  let foundPython = false;

  while (offset < command.length) {
    const end = statementEnd(command, offset);
    if (end === null) return null;
    const statement = command.slice(offset, end);
    const delimiter = heredoc.exec(statement);
    const argument = inline.exec(statement);
    let code: string | undefined;
    let next = end < command.length ? end + 1 : end;

    if (delimiter) {
      if (command[end] !== "\n") return null;
      const bodyStart = end + 1;
      let lineStart = bodyStart;
      let closing = -1;
      while (lineStart < command.length) {
        const newline = command.indexOf("\n", lineStart);
        const lineEnd = newline === -1 ? command.length : newline;
        if (command.slice(lineStart, lineEnd) === delimiter[2]) {
          closing = lineStart;
          next = newline === -1 ? command.length : newline + 1;
          break;
        }
        lineStart = lineEnd + 1;
      }
      if (closing === -1) return null;
      code = command.slice(bodyStart, closing);
    } else if (argument) {
      const decoded = literalArgument(argument[1]!, argument[2]!);
      if (decoded === null || command[end] === ";") return null;
      code = decoded;
    } else if (!simpleShell(statement)) {
      return null;
    }

    // Only a simple prefix followed by another command is supported, not compound lists.
    if (command[end] === ";") {
      const separator = /^;[ \t]+(?=\S)/.exec(command.slice(end));
      if (!separator) return null;
      next = end + separator[0].length;
    }
    if (code !== undefined) {
      if (shellStart < offset) {
        segments.push({ language: "shell", code: command.slice(shellStart, offset) });
      }
      segments.push({ language: "python", code, invocation: statement });
      foundPython = true;
      shellStart = next;
    }
    offset = next;
  }

  if (!foundPython) return null;
  if (shellStart < command.length) {
    segments.push({ language: "shell", code: command.slice(shellStart) });
  }
  return {
    segments,
    mixed: segments.some((segment) => segment.language === "shell" && segment.code.trim() !== ""),
  };
}
