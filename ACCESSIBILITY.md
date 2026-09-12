# Accessibility

Palot aims to support keyboard use, VoiceOver, reduced motion, reduced
transparency, increased contrast, and usable layouts at narrow desktop window
sizes.

The current source includes reduced-motion and reduced-transparency behavior,
semantic controls, status and error announcements, focus-managed dialogs, and
keyboard interaction in core areas. Deterministic desktop E2E covers onboarding,
new task, settings, destructive confirmation, large interface text, and a compact
semantic check of major routes.

The project has not completed a full manual accessibility audit. VoiceOver,
contrast across every theme, and less common settings and workbench flows still
need broader coverage, and no conformance claim is made.

## Supported preferences

- Reduce Motion removes or shortens non-essential transitions and animations.
- Reduce Transparency replaces translucent renderer surfaces with solid theme
  surfaces and follows the corresponding macOS setting for native materials.
- Interface text can be increased to 19px in Appearance settings; code, terminal,
  diff, and file-tree text have independent controls where density matters.
- Major dialogs trap keyboard focus and return it to the invoking control when
  that control still exists.

## Reporting an accessibility issue

Open a [GitHub Issue](https://github.com/ItsWendell/palot/issues) with:

- the screen or workflow;
- macOS and assistive technology versions;
- keyboard or VoiceOver steps;
- expected and actual behavior;
- screenshots or a recording when useful.

Do not include private prompts, source, credentials, or repository paths.

Accessibility fixes should preserve native semantics, visible focus, keyboard
reachability, readable contrast, motion preferences, and narrow-window use.
Visible changes should be checked with the relevant macOS accessibility setting
enabled.
