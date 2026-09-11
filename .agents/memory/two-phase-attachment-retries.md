---
name: Two-phase attachment retries
description: Retry-safety requirements for forms that create a parent record before uploading attachments.
---

For two-phase save flows, treat parent-record creation and every attachment upload as independently retryable operations. The parent creation must accept an identical retry without creating a duplicate, and each attachment must retain a stable client reference until it succeeds.

**Why:** A file-related failure or a lost response can leave a newly created record visible to the server while its form remains open. A user retry then resends the same client-generated record ID, causing a duplicate-key error; regenerating attachment references can also duplicate the files.

**How to apply:** When adding a create-then-upload form, use a persistent client ID for the parent request and stable per-file references for the form lifetime. After a successful parent create, retain its ID for attachment retries; remove only successfully uploaded files from the pending queue. The server must return the original record only for an equivalent retried create, and reject conflicting payloads.