import type { CatalogTool } from "./catalog";

// @opencode/codemode is not a published dependency/export of @opencode/client.
// Exact tokenize/termForms/rank algorithm and index fields from OpenCode v2.2.0 (unchanged in v2.2.1):
// packages/codemode/src/tool-runtime.ts (rank, toSearchEntry).
// https://github.com/anomalyco/opencode/blob/v2.2.0/packages/codemode/src/tool-runtime.ts
const tokenize = (query: string) =>
  query
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0 && term !== "*");
const termForms = (term: string) => {
  const forms = [term];
  if (term.endsWith("es") && term.length > 3) forms.push(term.slice(0, -2));
  if (term.endsWith("s") && term.length > 2) forms.push(term.slice(0, -1));
  return forms;
};
export function rank(catalog: readonly CatalogTool[], query: string): CatalogTool[] {
  const terms = tokenize(query).map(termForms);
  return catalog
    .map((tool) => {
      const path = tool.path.toLowerCase();
      const description = tool.description.toLowerCase();
      const pathWords = tokenize(tool.path);
      const searchText = [
        tool.path,
        tool.description,
        ...Object.entries(tool.properties ?? {}).flatMap(([name, property]) => {
          const description =
            property && typeof property === "object" && "description" in property
              ? property.description
              : undefined;
          return description === undefined ? [name] : [name, description];
        }),
      ]
        .join("\n")
        .toLowerCase();
      const score = terms.reduce(
        (total, forms) =>
          total +
          (forms.some((form) => path === form || path.endsWith(`.${form}`)) ? 20 : 0) +
          (forms.some((form) => pathWords.includes(form)) ? 12 : 0) +
          (forms.some((form) => path.includes(form)) ? 8 : 0) +
          (forms.some((form) => description.includes(form)) ? 4 : 0) +
          (forms.some((form) => searchText.includes(form)) ? 2 : 0),
        0,
      );
      return { tool, score };
    })
    .filter(({ score }) => terms.length === 0 || score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || (a.tool.path < b.tool.path ? -1 : a.tool.path > b.tool.path ? 1 : 0),
    )
    .map(({ tool }) => tool);
}
