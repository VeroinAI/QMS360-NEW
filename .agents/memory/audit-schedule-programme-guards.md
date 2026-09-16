---
name: Audit schedule programme guards
description: Compatibility and authorization rules for parent programmes stored with child Audit schedules.
---

Parent Audit programmes share persistence with child Audit schedules for backward compatibility, but they are distinct record kinds. Every legacy child endpoint and every downstream schedule reference must reject programme records.

**Why:** Without a kind guard, legacy submit, review, delete, evidence, plan, or audit routes can bypass the programme's sequential approval workflow. Project-scope checks over multiple children must also be awaited before deciding access; testing unresolved promises silently grants access.

**How to apply:** When adding a route that accepts an Audit schedule ID, assert that it is a child before reading or mutating it. For programme mutations, allow administrator bypass only; otherwise await scope checks for every active child and reject if any child is outside the actor's scope.