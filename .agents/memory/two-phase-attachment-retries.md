---
name: Two-phase attachment retries
description: Retry-safety requirements for forms that create a parent record before uploading attachments.
---

For two-phase save flows, treat parent-record creation and every attachment upload as independently retryable operations. The parent creation must accept an identical retry without creating a duplicate, and each attachment must retain a stable client reference until it succeeds.

**Why:** A file-related failure or a lost response can leave a newly created record visible to the server while its form remains open. A user retry then resends the same client-generated record ID, causing a duplicate-key error; regenerating attachment references can also duplicate the files.

**How to apply:** When adding a create-then-upload form, use a persistent client ID for the parent request and stable per-file references for the form lifetime. After a successful parent create, retain its ID for attachment retries; remove only successfully uploaded files from the pending queue. The server must return the original record only for an equivalent retried create, and reject conflicting payloads.

## Authenticated raw uploads

Native browser `fetch` calls do not inherit the API client's bearer-token injection.

**Why:** Evidence intent creation can succeed through the generated client while its following raw file PUT receives a 401 from the protected file endpoint.

**How to apply:** For a browser upload that deliberately uses native `fetch`, explicitly attach the same stored bearer token used by the API client. Preserve the server-side authorization check; do not make the file endpoint public to work around an omitted header.