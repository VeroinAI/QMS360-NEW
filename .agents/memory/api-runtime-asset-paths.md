---
name: API runtime asset paths
description: Production working directory differs from artifact-filtered development when loading runtime assets.
---

Do not assume the API process's working directory is its artifact directory. Resolve runtime assets through an explicit build/package contract, independent of the process working directory.

**Why:** Production was observed launching the API from the workspace root, while artifact-filtered development and PDF tests ran from the API artifact directory. A working-directory-relative asset read passed development checks but failed final approval in production.

**How to apply:** Bundle static assets into the server build, or copy them to a defined output location and resolve them relative to the emitted module. Verify built-server asset loading from the workspace root as well as the artifact directory; artifact-local tests alone do not cover this deployment constraint.