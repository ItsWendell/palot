# React Compiler

React Compiler 1.0 is stable, but Palot keeps it off by default until representative before/after runs show a net win without behavior changes.

- Fix Rules of React and compiler diagnostics before expanding coverage.
- Start risky areas in `annotation` mode with `"use memo"` on measured components.
- Use `infer` only as an experiment until session switching, streaming, workbench, settings, and E2E behavior pass.
- Do not add runtime gating by default. It ships both compiled and uncompiled functions.
- Verify bundle size and build time as well as runtime behavior.
