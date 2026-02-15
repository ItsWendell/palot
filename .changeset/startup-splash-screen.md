---
"@palot/desktop": minor
---

Add a two-layer startup splash screen with phase-based status messages ("Starting server...", "Connecting...", "Loading projects..."). A transparent HTML splash renders instantly before JS loads, then hands off to a React overlay that fades out once discovery completes. Both layers are transparent so macOS liquid glass and vibrancy effects show through.
