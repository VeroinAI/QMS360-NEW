---
name: Wouter :rest* matches only one path segment
description: In this project's wouter version, /settings/:rest* style wildcard routes do NOT match multi-segment paths — deep URLs need explicit App-level routes.
---

In artifacts/qms360, wouter (3.10.0 + regexparam 3.0.0) compiles `:rest*` to a single-segment matcher (`[^/]+?`), not a true multi-segment wildcard. So `<Route path="/settings/:rest*">` matches /settings/lessons but NOT /settings/lessons/roles.

**Why:** All deep settings tab URLs (/settings/:app/:tab) silently fell through to the NotFound route until an explicit `<Route path="/settings/:app/:tab">` was added in App.tsx. Same pattern already existed for audit (/audit/audits/:id).

**How to apply:** When adding a nested route deeper than one segment under /qaqc, /lessons, /audit, /cockpit, or /settings, add an explicit multi-segment Route in artifacts/qms360/src/App.tsx — do not rely on the `:rest*` catch-all.
