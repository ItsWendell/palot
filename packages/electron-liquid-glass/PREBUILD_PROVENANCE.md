# Native prebuild provenance

The checked-in macOS binaries were built from this repository's tracked
`electron-liquid-glass` fork using the source inputs identified by SHA-256 below.
These are local source-build outputs, not binaries downloaded from the upstream
npm package.

## Build environment and command

- Apple Silicon host; macOS 26.6.2 (25G83).
- Apple Command Line Tools 26.6.0.0.1781586589; Apple clang 21.0.0
  (`clang-2100.1.1.101`); linker `ld-1267`; macOS SDK 26.5; Python 3.9.6.
- Bun 1.4.2; host Node 24.21.0; Vite+ launcher 0.2.4 / workspace 0.3.1.
- Frozen dependencies: prebuildify 6.0.1, node-gyp 12.4.0, node-addon-api 8.9.2,
  node-abi 3.95.0, tsdown 0.22.14.
- Prebuildify's N-API default selected **Node 26.0.0 headers**, not the host
  Node version. The downloaded `node-v26.0.0-headers.tar.gz` checksum from
  `https://nodejs.org/dist/v26.0.0/SHASUMS256.txt` is
  `cefe207f1f02075ed0e72dac1799188841b5d1e50eea83074feaea3d26960b11`.

From the repository root, with the pinned Bun and Node on `PATH`:

```sh
vp install --frozen-lockfile
bun run --cwd packages/electron-liquid-glass build:all
```

The package script runs:

```sh
prebuildify --napi --strip --tag-armv --arch=arm64
prebuildify --napi --strip --arch=x64
```

It then runs the JavaScript bundle/declaration build. Both architectures were
compiled on the arm64 host; no Intel binary or Rosetta process was executed.

## Source input SHA-256

Paths below are relative to this package unless prefixed with `/` (repository
root). These identify the build inputs independently of Git history.
The root manifest and lockfile hashes record their build-time versions, which
differ from the current checkout.

```text
51526d127dbaf5fc16fb6d7d0993bd77d0e010356cd001d09e2424ef413098be  binding.gyp
44cabc55f0e7ff3080b57c4185f04a4ed5922504064b8178491f87f13bf4b730  include/Common.h
755d184bef92c43f12007d38a5b8e09857b4315cb86d21dfd30171ade768082d  src/glass_effect.mm
d21e0120a19160bec23fa676ad8ffa95046ab81bbcf9f889131c7968140f1a04  src/liquidglass.cc
9ca067989e7141d6665256f2cfca1eed78a0337cf2bae4e615f85a728dd84947  package.json
95a8abe299cfca2366ef8184277929c51b2191eaf746537d5fa2852c569d8196  js/index.d.ts
3b332036ca12df7a9a140f71cf5aeac8c8cdfae22afd5804e9319c41268e6fac  js/index.ts
dfead0c3980e4e17ac26a43d2a5ae15e51bdafe1b9bf4dd797e3d7ee3c94c0ee  js/native-loader.ts
476ee930a9bf954dfc070db07a820f40666c81ecbb02ce9b9b80b726a0e8db08  js/variants.ts
fdcd13e7c807a1a460eea4e50e7ca3dcb8b16f573c3761e38da41f8e4cc944b2  tsconfig.build.json
11a68339a9c6a0c04a67b95dff9eefd9a92c42fa35161411048405272ab192c8  tsconfig.json
8276b669a813880b30db0b29093b62d175addde58cf2ddbb65f9aa27b47d0444  tsdown.config.ts
132a80e528ec8fc0efd361f4a0b19591da0d493256b06262219eb61f76a65030  /bun.lock
d0b611e24756621ee675c42f1d8896eb4729b423e048a2f4e9db9a45a25f8b66  /package.json
```

## Checked-in output SHA-256

```text
0911c5a07ea44e87cce39d3f470b50df6d445975e4a6303ade35c6538ed9de2e  prebuilds/darwin-arm64/electron-liquid-glass.armv8.node
4faf0749d7991290f02749e3b70c725ed1d1ced18ba442931f4ada0b11758343  prebuilds/darwin-x64/electron-liquid-glass.node
```

**Bit-for-bit reproducibility is not established.**

## Verification and limits

- `file`, `lipo -archs`, `otool -L`, `otool -l`, and `nm -gU` confirmed separate
  arm64/x86_64 Mach-O bundles, N-API registration exports, no `LC_RPATH`, and only
  Apple system dependencies: AppKit, CoreFoundation, Foundation, libc++,
  libSystem, and libobjc. Load-command minimum OS versions are 11.0 (arm64) and
  10.14 (x64); these are linker metadata, not tested compatibility guarantees.
- An isolated, service-free Electron 44.3.0 arm64 fixture loaded the generated
  JavaScript wrapper and the exact arm64 prebuild. A separate test-only Objective-C
  observer confirmed a real `NSGlassEffectView` in a 920×640 BrowserWindow, not
  the legacy blur fallback. Assertions passed for dark/light/system appearance,
  corner radius, tint-layer updates, removal/re-addition, and renderer response.
  The checked-in arm64 output passed this smoke test.
- This was a hidden-window native integration test, not a visual/compositor or
  full Palot application test. Intel runtime behavior, older macOS fallback,
  signing/notarization, and packaged distribution remain unverified here.
