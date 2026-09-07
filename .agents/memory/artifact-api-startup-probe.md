---
name: Artifact API startup probe
description: Publish-time health probing behavior for API artifacts mounted below the root path.
---

An API artifact must return HTTP 200 at its preview path as well as at its dedicated health endpoint.

**Why:** An Autoscale publish repeatedly probed `/api` and failed promotion even though `artifact.toml` configured `/api/healthz` and that endpoint returned 200.

**How to apply:** For API artifacts mounted at a path such as `/api`, keep the dedicated health endpoint but also make an unauthenticated `GET` on the artifact preview path return the same lightweight health response.