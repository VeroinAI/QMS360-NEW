---
name: Process audit department scope
description: Authorization rule for department-based Quality Internal Process Audits without project IDs
---

Quality Internal Process Audit schedules use the `departments` master-data LOV and intentionally carry no project IDs. Their plans, audits, findings, and CARs may therefore also be projectless. Project-scope middleware must recognize this parent chain instead of rejecting every null-project record.

**Why:** Treating all Audit records as project-backed allowed Process schedules to be created and listed but blocked their detail, edit, plan, and downstream routes.

**How to apply:** For Quality Internal Product Audits, continue requiring and enforcing a project ID. For Quality Internal Process Audits, require a valid department and authorize projectless descendants only when their source schedule is a Process audit.