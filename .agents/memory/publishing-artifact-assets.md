---
name: Publishing artifact assets
description: Static asset ownership and auxiliary-artifact failures during QMS360 publishing.
---

Package required static brand assets with the artifact that uses them instead of depending on the uploads directory.

**Why:** QMS360 publishing builds auxiliary artifacts too. A missing video logo in uploads blocked the entire publish even though the main application and API built successfully.

**How to apply:** Preserve original artwork, use bundler-resolved asset URLs that respect the artifact base path, and inspect all configured artifact build results when diagnosing publishing failures.
