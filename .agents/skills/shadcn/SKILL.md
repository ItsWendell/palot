---
name: shadcn
description: Use when adding, updating, composing, or debugging source components managed by shadcn; changing apps/desktop/components.json, registries, or presets; or running the shadcn CLI. Do not use for cosmetic layout or styling changes that only add classes around existing primitives.
slash: false
---

# shadcn/ui in Palot

Palot pins the shadcn CLI in `apps/desktop`. Run it from that workspace through Vite+:

```sh
vp exec -- shadcn info --json
vp exec -- shadcn docs <component>
```

Do not use `npx`, `pnpm dlx`, `bunx`, or an `@latest` CLI. Preserve the repository pin and the aliases, Tailwind file, primitive base, icon library, and registries reported by `info`.

## Choose the work

- Existing-source fixes: inspect the component and relevant callers first. Use the local implementation as the contract; CLI discovery and external docs are unnecessary when that evidence answers the question.
- Adding components or changing registry/configuration: read repository-root `../../../apps/desktop/components.json` and run `vp exec -- shadcn info --json` from `apps/desktop`. Prefer existing local primitives and variants; use `search` or `view` when looking for a missing component.
- Unclear APIs or upstream behavior: use `vp exec -- shadcn docs <component>` and fetch the relevant returned documentation. Reconcile it with the local source before applying it to customized components.
- Upstream component updates: follow the preview workflow below.

Inspect changed imports and CSS where applicable, then run `vp check --fix <touched-files>` and the smallest checks warranted by the changed behavior.

## Updating components

Use the CLI rather than fetching upstream source manually:

1. Run `vp exec -- shadcn add <component> --dry-run` to list affected files.
2. Run `vp exec -- shadcn add <component> --diff <file>` for each customized file.
3. Apply upstream changes while preserving local behavior and imports.
4. Use `--overwrite` only when the user explicitly authorizes replacing local changes.

## Project rules

- Use semantic theme tokens rather than raw colors or manual dark-mode overrides.
- Use `gap-*`, `size-*`, `truncate`, and `cn()` rather than equivalent verbose utilities.
- Compose forms with `FieldGroup` and `Field`; put collection items inside their matching group.
- Dialog-like surfaces require an accessible title.
- Prefer shared components such as `Alert`, `Empty`, `Separator`, `Skeleton`, and `Badge` over hand-built equivalents.
- Keep layout decisions in call sites and reusable visual behavior in component variants.

## References

Read only the branch needed for the task:

- Styling and Tailwind: `rules/styling.md`
- Forms and validation: `rules/forms.md`
- Component composition: `rules/composition.md`
- Base UI versus Radix APIs: `rules/base-vs-radix.md`
- Icons: `rules/icons.md`
- Chat primitives: `rules/chat.md`
- CLI commands: `cli.md`
- Registries: `registry.md`
- Presets and customization: `customization.md`
