---
name: Create-form idempotency keys
description: Lifecycle rule for browser-stored keys used to make create requests safely retryable
---

A create-form idempotency key may survive failed uploads and uncertain network responses, but it must be cleared or rotated after the create workflow completes successfully. Version the storage key when repairing stale deployed clients.

**Why:** Reusing one session-scoped key for every visit to a “new form” page caused later creates to return the first record as an idempotent replay. The UI reported success while no new record appeared, and attachments accumulated against the old record until limits were reached.

Bulk file imports need the same protection per row. Derive a stable row identifier from the parent scope and normalized row content so retrying a partially successful file replays completed rows instead of duplicating them.

**How to apply:** Give each new draft one stable key, retain it only while that draft may need a safe retry, continue with the server-returned record ID, and retire the key before starting another draft. For bulk imports, keep each normalized row's key deterministic across file retries.