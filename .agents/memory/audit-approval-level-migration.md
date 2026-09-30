---
name: Audit approval level migration
description: Preserving historical Audit approver chains when moving sequence from role names to stored levels.
---

New Audit approval chains must order by the role's saved authorization level, never parse its name to determine the sequence. Existing submitted programmes and schedules retain the role-ID/name chain captured at submission even if administrators change levels later. Pre-existing roles whose names encoded L-number order may be assigned their initial stored levels once, but newly edited approval roles require an explicit level.

**Why:** Approval continuity matters during rollout. The managed Publish flow applies schema differences, not data statements in generated migration SQL, so legacy roles in production need a one-time data compatibility path rather than losing their approval order.

**How to apply:** Separate initial legacy-level materialization from normal sequence resolution; never recalculate the sequence of already-submitted records from live role settings.