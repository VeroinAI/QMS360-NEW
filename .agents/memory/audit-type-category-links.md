---
name: Audit type-category links
description: User-selected governance for Audit Schedule category choices.
---

Standard Product Audits allow only Project. Standard Process Audits allow only Business Unit, Regional Office and Warehouse, never Project. These restrictions override old master-data links. Other custom audit types continue to follow administrator-configured master-data links.

**Why:** The user subsequently explicitly requested the Product/Process split for Create Audit. Earlier custom type/category linking remains applicable outside those standard types.

**How to apply:** Enforce the standard split in both UI and API for new or changed pairs. Custom types keep unconfigured lists usable until links exist. Preserve unrelated edits on older schedules without forcing their saved type/category pair to change.