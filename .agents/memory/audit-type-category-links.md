---
name: Audit type-category links
description: User-selected governance for Audit Schedule category choices.
---

Audit Schedule category choices should follow links configured by administrators in master data, not a hardcoded mapping between category labels and Audit Type names.

**Why:** The user clarified that they want to link Audit Types to Audit Categories manually. Existing schedule data uses categories across types, so inferring a fixed split would risk changing historical behavior.

**How to apply:** Keep unconfigured lists usable until links exist, then restrict new combinations to linked values. Preserve the ability to edit unrelated fields on older schedules without forcing their historical type/category pair to change.