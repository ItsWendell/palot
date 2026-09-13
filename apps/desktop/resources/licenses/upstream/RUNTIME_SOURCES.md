# Runtime component sources

Source locations for the pinned runtime artifacts and their retained notices.

## Ghostty terminal WebAssembly

The bundled `ghostty-vt.wasm` comes from ghostty-web commit
`83c0a07b8628b748aed073b232cb4b52a6ca11c1`:

- Wrapper and WebAssembly source/build patch:
  <https://github.com/anomalyco/ghostty-web/tree/83c0a07b8628b748aed073b232cb4b52a6ca11c1>
- Ghostty source:
  <https://github.com/ghostty-org/ghostty/tree/f9194f93deeec82670771fc3909132b37356b155>
- z2d 0.10.0 Source Code Form, under MPL-2.0 and the notices in
  `z2d.LICENSE.txt`, is available without charge at:
  <https://deps.files.ghostty.org/z2d-0.10.0-j5P_Hu-6FgBsZNgwphIqh17jDnj8_yPtD8yzjO6PpHRQ.tar.gz>.
  This is the archive selected by Ghostty's pinned dependency manifest.
  Palot makes no changes to this source. See `z2d.COPYING.txt` for MPL-2.0,
  including the rights to obtain, modify, and redistribute the covered source.
- uucode 0.2.0 source and Unicode/UTF-8 notices:
  <https://deps.files.ghostty.org/uucode-0.2.0-ZZjBPqZVVABQepOqZHR7vV_NcaN-wats0IB6o-Exj6m9.tar.gz>
- Zig 0.15.2 source (the Ghostty build's declared minimum compiler version):
  <https://github.com/ziglang/zig/tree/e4cbd752c8c05f131051f8c873cff7823177d7d3>

The complete upstream z2d license document retains its test-font and test-code
sections. Their presence here does not identify those test assets as shipped.
`z2d-pixman.NOTICE.txt` additionally retains the complete radial-gradient
file-level notice from z2d's `src/gradient.zig`, lines 565–589.

## OpenCode 2.0.2 and Bun 1.4.2

The OpenCode executable is acquired separately from its official distributor,
not included in Palot's desktop installers. These references identify the runtime
used for Palot's integration checks.

- OpenCode publication source:
  <https://github.com/anomalyco/opencode/tree/cf4f1fb45e2695d86a4ef8c20a3883f4ac79935a>
- Bun runtime source:
  <https://github.com/oven-sh/bun/tree/744846f844374847c902b5e7fd59b4342a51ef99>
- Bun's pinned WebKit/JavaScriptCore source:
  <https://github.com/oven-sh/WebKit/tree/2e2aa2290fac856d6f451ceacb58f7f5b44dd057>

`bun-1.4.2.LICENSE.md` is Bun's unchanged upstream licensing document, including
its linked-library list and build/relink instructions.
`bun-webkit.COPYING.LIB.txt` is the unchanged
`Source/JavaScriptCore/COPYING.LIB` from the pinned WebKit revision.
