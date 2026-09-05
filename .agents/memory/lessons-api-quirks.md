---
name: Lessons API request-body quirks
description: disciplineId/categorisationId take master-data values, and the server assigns its own record id on create
---

The lessons create/update API validates `disciplineId`/`categorisationId` against master-data **values** (names, not UUIDs) and ignores any client-supplied record id on create, assigning its own.

**Why:** both produce misleading failures — 422s that look like validation bugs, and 404s when you keep using the client-generated id for follow-up PUT/DELETE calls.

**How to apply:** pass master-data values for those two fields and always continue with the id returned by the create response.
