---
name: Browser email-rule test isolation
description: Safety rationale for using disposable organizations in email-rule browser checks.
---

Use a disposable organization and administrator when a browser check saves enabled email rules. Do not rely on shared demo accounts or leave enabled rules in an existing organization.

**Why:** An enabled test rule can accidentally receive real organization events while a check runs. Shared seeded sign-in credentials have also been unavailable in this workspace, independently of the feature being verified.

**How to apply:** Create an isolated fixture, keep its session in memory, verify selection/save/reload against the real API, and remove its rules, logs and organization afterward. Do not reschedule live audits just to verify the editor.
