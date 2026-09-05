# Memory Index

- [Drizzle multi-schema push/generate quirks](drizzle-multischema-quirks.md) — drizzle-kit generate/push need an interactive TTY here; use export SQL + manual schema creation instead.
- [Optional UUID input normalization](optional-uuid-normalization.md) — normalize blank optional UUID form values to null at API boundaries before database writes.
- [Orval codegen rejects format: uuid](openapi-format-uuid-quirk.md) — `format: uuid` in openapi.yaml emits `zod.uuid()` (unsupported here); use plain `{type: string}`.
- [RBAC setup for testing non-admin writes](demo-seed-users.md) — seeded workspace roles start with zero permission grants, so non-admin writes 403 until granted; never store credentials in memory.
- [Lessons API request-body quirks](lessons-api-quirks.md) — discipline/categorisation take master-data values not UUIDs; server assigns its own id on create.
