# Dependency license metadata

The dependency-license generator collects license and notice texts from installed
packages. Two version-bound data files supplement conventional package-root
license files:

- `DEPENDENCY_LICENSE_EVIDENCE.json` identifies texts within installed package
  files or the Palot workspace, including source hashes and inclusive line ranges.
- `DEPENDENCY_LICENSE_UPSTREAM.json` maps exact package versions to immutable
  upstream source manifests and the license texts retained in `upstream/`.

Generation is offline. Entries must match the package name, version, declared
license, manifest hash, and retained text hashes. The generator rejects missing
files, changed metadata, and paths outside their declared scope.

Run from the repository root after installing dependencies:

```sh
bun apps/desktop/scripts/generate-dependency-licenses.ts --check
```

The generated `DEPENDENCY_LICENSES.md` is local build output. Vendored component
attributions are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); authoritative
license texts are retained verbatim in this directory and `upstream/`.
