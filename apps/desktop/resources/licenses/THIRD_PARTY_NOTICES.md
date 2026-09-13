# Third-party notices

This file consolidates notices for vendored source, local packages, and
dependencies used by Palot. Additional authoritative license texts are retained
in this directory and `upstream/`. Build-generated dependency notices are written
to `DEPENDENCY_LICENSES.md`; release artifacts also include a CycloneDX SBOM.

## Themes

Theme names identify visual presets and do not imply endorsement by another
product. Themes supplied by `@shikijs/themes` and `@pierre/theming` retain the
licenses and notices distributed with those packages.

## OpenCode provider icons

`src/renderer/components/ui/provider-icons` is vendored from
[`anomalyco/opencode`](https://github.com/anomalyco/opencode), commit
`b09a74591cbd4d2ea1488e56177898a13f21278d`. Provider names and logos may be
trademarks of their respective owners.

MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## TanStack Markdown

`src/renderer/components/palot-markdown-react.tsx` is adapted from the React
renderer in [`@tanstack/markdown`](https://github.com/TanStack/markdown),
version 0.0.13.

The adapted source identifies immutable revision
[`720e8c2db5973a3401914a8b96d9fd05c30d6fc5`](https://github.com/TanStack/markdown/blob/720e8c2db5973a3401914a8b96d9fd05c30d6fc5/src/react.ts).
Its [package manifest](https://github.com/TanStack/markdown/blob/720e8c2db5973a3401914a8b96d9fd05c30d6fc5/package.json)
declares MIT and version 0.0.13.

The adapter also incorporates list, footnote, inline component, and fence metadata
fixes from version 0.0.15, revision
[`6936a0106d2c8759d51f15aa8ad98f7363817bbb`](https://github.com/TanStack/markdown/blob/6936a0106d2c8759d51f15aa8ad98f7363817bbb/src/react.ts).
That revision's [package manifest](https://github.com/TanStack/markdown/blob/6936a0106d2c8759d51f15aa8ad98f7363817bbb/package.json)
also declares MIT. The published 0.0.15 package omits a license file;
`DEPENDENCY_LICENSE_DECLARATIONS.json` records the verified package and source
manifests. The standard terms of the declared license are reproduced below.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## electron-liquid-glass

Palot ships a local package based on
[`electron-liquid-glass`](https://github.com/Meridius-Labs/electron-liquid-glass),
version 1.1.1. The local package preserves the upstream project and license
metadata while carrying the native binaries used by Palot.

The Git-tracked macOS prebuilds also incorporate Node-API/node-addon-api headers.
Their additional notices are retained in
[`upstream/node-addon-api.LICENSE.txt`](upstream/node-addon-api.LICENSE.txt)
(node-addon-api 8.9.2) and
[`upstream/node-api-headers.LICENSE.txt`](upstream/node-api-headers.LICENSE.txt)
(Node 26.0.0 primary grants).

MIT License

Copyright (c) 2025 Meridius Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## objc-js

Palot ships [`objc-js`](https://github.com/iamEvanYT/objc-js), version 1.5.0,
to read and request macOS notification authorization through public Apple APIs.

MIT License

Copyright (c) 2026 iamEvan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Palot Orbits and thinking-orbs

Palot ships the local `@palot/orbits` package. Its rendering engine and React
wrapper are adapted from
[`thinking-orbs`](https://github.com/Jakubantalik/thinking-orbs) by Jakub
Antalik.

MIT License

Copyright (c) 2026 Jakub Antalik
Copyright (c) 2026 Palot contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## node-gyp-build

Palot ships `node-gyp-build`, version 4.8.4, as the native module loader for
electron-liquid-glass and objc-js.

The MIT License (MIT)

Copyright (c) 2017 Mathias Buus

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Bundled fonts

Palot ships Fontsource packages for Inter, DM Sans, IBM Plex Sans, Geist,
Geist Mono, JetBrains Mono, and Fira Code. Their copyright notices are listed
in `FONTS.md`. Each font is distributed under the SIL Open Font License,
Version 1.1, included as `OFL-1.1.txt`.
