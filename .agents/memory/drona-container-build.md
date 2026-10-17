---
name: Drona container asset and navigation isolation
description: Keep portable Drona container assets separate from root/path-mounted Replit builds.
---

Use a dedicated Drona build with relative asset URLs and hash navigation; keep
normal Replit builds and their existing browser-history/PWA behavior separate.

**Why:** The AWS/Drona team reported that mobile containers do not necessarily
serve the bundle at the versioned mount used during their previous build.
Absolute asset paths produced empty 404s and a blank screen. Asset relocation
also must not change the application's route base or let it install a
root-scoped service worker on a shared container origin.

**How to apply:** Deliver explicit Drona build/deployment instructions with
frontend changes affecting hosting. Keep API/protected-file routing separate
from static asset paths: a portable bundle does not itself provide an API
bridge for a local-scheme or different-origin container. Actual device/session
verification remains the infrastructure team's deployment acceptance step.
