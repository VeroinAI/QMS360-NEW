---
name: Audit schedule register policy
description: Individual-audit register semantics and preservation of annual programme management.
---

The Schedules landing register represents individual child audits, while annual programme management must remain available separately. A register redesign is not a change to the programme approval model or permission grants.

**Why:** The requested Audit Type, Audit Category, Project/Department and Location columns describe individual audits, not the annual parent programmes that previously occupied the landing page.

**How to apply:** Preserve programme creation, navigation and existing approval/actions when changing the register. Apply register filters across all authorized results before paginating; filtering only the currently loaded page omits valid matches.

The Dates filter uses inclusive overlap with the audit's planned period, including audits that start before the selected range but continue into it.

**Why:** Audits can span multiple days; a start-date-only filter would hide audits taking place during the requested dates.

**How to apply:** Support either date boundary independently, reject invalid ranges explicitly, and retain organization-format date entry with ISO values internally.
