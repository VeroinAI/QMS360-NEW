---
name: Workspace package installation
description: Why the package installer cannot install dependencies in a leaf pnpm artifact in this workspace.
---

The language-package installer invokes an unscoped root `pnpm add` and rejects `--filter` as an invalid package token. A pnpm monorepo root rejects that add without an explicit root flag. For dependencies consumed only by a leaf artifact, use an artifact-filtered pnpm add when the installer cannot express workspace scoping; do not force the dependency into the root package.

**Why:** Two installer approaches failed (root add and passing pnpm flags as package tokens); the artifact-filtered pnpm command succeeded and kept runtime dependencies declared where they are used.

**How to apply:** When adding a leaf-only dependency, attempt the normal package installer first; if it cannot express workspace scope, use pnpm's filter targeting the consuming artifact and verify its package manifest and lockfile.