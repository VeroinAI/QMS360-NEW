---
name: Finding priority action policy
description: Manual priority selection belongs to each Findings row, not the Report Details editor.
---

Each finding's “Recommended priority actions” is a single choice from “Contain
the risk now”, “Correct and close”, and “Prevent recurrence”. It follows Action
Taker in the Add Finding popup and spreadsheet-style Findings table, and becomes
mandatory when an Action Taker is selected.

**Why:** On 2026-10-09 the user requested a finding-level choice and removal of
the Report Details tile, without affecting other development.

**How to apply:** Validate the choice on the client and API. Save assignment
and priority together; retain a previously chosen priority when reassigning.
Do not invent defaults or backfill older findings. Existing findings without a
priority remain readable and can obtain the required choice when edited.

Hide the Report Details priority-action tile without deleting historical
report-detail data or silently changing unrelated report generation.

**Why:** Removing an editor tile is not authorization to delete prior values
or change other report behavior.

**How to apply:** Keep hidden values intact during other Report Details saves;
require an explicit request before removing historical report data.
