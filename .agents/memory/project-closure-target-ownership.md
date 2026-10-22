---
name: Project closure target ownership
description: Master-data ownership and read-only QA/QC display after reorganizing Reporting Settings.
---

Maintain project Closure Target (%) values in Integration cockpit → Project Master → Additional Data. QA/QC Reporting Settings retains a read-only target view, not a second editor.

**Why:** The user moved maintenance into Project Master and specifically required the Reporting Settings fields to read their values from the respective project master. Although the request also mentioned removing that tile, its later detailed instruction explicitly retained it read-only.

**How to apply:** Keep both views backed by the same project-owned values; preserve existing saved targets and report calculations when reorganizing screens. Do not reintroduce an editable target copy in Reporting Settings.

Responsible people, Distribution and Scheduled distribution status were requested removed from the Reporting Settings interface, not deleted from saved project configuration.

**Why:** The user requested a screen reorganization without disturbing other development. Deleting those values or disabling workflows would change approval eligibility and scheduled delivery.

**How to apply:** Preserve saved assignments and scheduling behaviour unless the user separately authorizes changes to those workflows.
