# Memory Index

- [Drizzle multi-schema migration quirks](drizzle-multischema-quirks.md) — drizzle-kit's state is meta/*_snapshot.json, not the .sql files; hand-written migrations silently desync the diff engine.
- [Optional UUID input normalization](optional-uuid-normalization.md) — normalize blank optional UUID form values to null at API boundaries before database writes.
- [Orval codegen rejects format: uuid](openapi-format-uuid-quirk.md) — `format: uuid` in openapi.yaml emits `zod.uuid()` (unsupported here); use plain `{type: string}`.
- [RBAC setup for testing non-admin writes](demo-seed-users.md) — seeded workspace roles start with zero permission grants, so non-admin writes 403 until granted; never store credentials in memory.
- [Lessons API request-body quirks](lessons-api-quirks.md) — discipline/categorisation take master-data values not UUIDs; server assigns its own id on create.
- [Wouter :rest* wildcard limitation](wouter-rest-wildcard.md) — :rest* matches one segment only; deep nested routes need explicit App.tsx routes.
- [QMS360 typecheck baseline is red](qms360-typecheck-baseline.md) — qms360 typecheck fails on pre-existing stale api-client-react type exports; diff against baseline, trust the running Vite app instead.
- [Orval zod export naming](openapi-zod-naming.md) — zod consts get operationId-derived names; component schemas are types only; `<OperationId>Body` schema names collide with TS2308.
- [SSRF policy for outbound URLs](egress-ssrf-policy.md) — tenant-configured URLs with credentials need pinned DNS + SOURCE_SYNC_ALLOWED_HOSTS allowlist; never plain fetch; classify IPs on 16-byte form.
- [SheetJS secure releases](sheetjs-secure-releases.md) — npm xlsx stops at a vulnerable release; use the official SheetJS CDN tarball for patched versions.
- [Video scaffold controls & tsconfig](video-scaffold-controls.md) — video-js scaffold ships workspace-driven controls (supersedes scene-selectors.md); artifact tsconfig needs DOM lib override or typecheck is red.
- [Field-access enforcement landscape](field-access-enforcement-landscape.md) — two field-control stores, both API-enforced; register new controllable fields in both catalogs; pg enum blocks locks on platform entities (projects/users).
