# Palot electron-liquid-glass fork

This workspace package is based on `electron-liquid-glass` 1.1.1. Palot keeps it local because the published package does not expose a way to update an `NSGlassEffectView` when Electron's `nativeTheme.themeSource` changes.

The fork adds explicit appearance and tint updates, a native AppKit tint layer behind Electron content, and view cleanup when a window closes. Prebuilt N-API binaries for macOS arm64 and x64 are checked in so development and packaging do not require a local native build.

Regenerate the JavaScript bundle and native binaries with:

```sh
bun run build:all
```

The original MIT license is preserved in `LICENSE`.
