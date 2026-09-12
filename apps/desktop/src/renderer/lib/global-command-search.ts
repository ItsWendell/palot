import fuzzysort from "fuzzysort";
import { commandSearchText, type GlobalCommand } from "./global-commands";

function normalized(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function lexicalScore(command: GlobalCommand, query: string): number {
  const title = normalized(command.title);
  const text = normalized(commandSearchText(command));
  if (title === query) return 5;
  if (title.startsWith(query)) return 4;
  if (title.split(/\s+/).some((word) => word.startsWith(query))) return 3;
  if (title.includes(query)) return 2.5;
  if (text.includes(query)) return 2;
  return 0;
}

export function rankGlobalCommands(
  commands: readonly GlobalCommand[],
  rawQuery: string,
): GlobalCommand[] {
  const query = normalized(rawQuery);
  if (!query) return [...commands];

  return commands
    .map((command, index) => {
      const lexical = lexicalScore(command, query);
      const fuzzy = fuzzysort.single(query, commandSearchText(command))?.score ?? 0;
      const score = Math.max(lexical, fuzzy) + (command.suggested ? 0.025 : 0);
      return { command, index, score };
    })
    .filter(({ score }) => score > 0)
    .toSorted((left, right) => right.score - left.score || left.index - right.index)
    .map(({ command }) => command);
}
