---
name: Department role scope boundaries
description: Product boundaries for department assignments in Audit and QA/QC.
---

Department role scopes use the existing organization Department Master across
applications. Administrators do not need Lessons access to administer departments
in Audit or QA/QC. Department-only roles grant application entry, not organization
or project access, and unrelated roles must not supply the scope for a capability.

QA/QC reporting remains project-based. Department assignment support does not
introduce department report forms, ownership, numbering, artificial projects,
automatic reassignment, new approval processes, or Drona membership changes.

**Why:** The department-assignment requirement explicitly separates application
entry and administrative scope from new department-based QA/QC reporting models.

**How to apply:** Keep department scope independent from project membership,
including Drona restrictions and combined role grants. Treat department-based
QA/QC reporting as a separate product decision, not an implied extension.
