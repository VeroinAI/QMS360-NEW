---
name: Lessons overview count policy
description: Project-filter scope and preserving recent-record semantics in the Lessons overview.
---

The Lessons overview Project selector applies to every displayed tile. The personal creation count includes all accessible, non-deleted lessons created by the logged-in user, regardless of status, rather than only the loaded recent page.

**Why:** The user requested project-dependent tile values and a personal creation count, while requiring unrelated development to remain unaffected.

**How to apply:** Preserve server-enforced access boundaries and user-specific query caches. Keep the existing Major + Negative open **(recent)** tile based on the selected project's recent records unless the user separately asks for a full-dataset count; do not silently change that tile's meaning.
