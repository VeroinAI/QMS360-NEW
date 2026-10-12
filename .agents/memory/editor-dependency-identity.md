---
name: Editor dependency identity
description: Why rich-editor verification must exercise typing, not just build or mount
---
Class-identity-sensitive editor libraries can fail only when editing begins, even after a clean typecheck, production build, and successful initial editor render.

**Why:** In this pnpm workspace, existing pinned editor dependencies and newly resolved editor dependencies produced incompatible ProseMirror Fragment classes. The email editor mounted normally but crashed upon typing.

**How to apply:** When changing rich-editor dependencies, inspect the actual transitive resolutions, keep the consuming artifact on one model-class identity without broadly changing other artifacts, and verify typing, selection and formatting in a real browser. A build or screenshot of an empty editor alone is insufficient.
