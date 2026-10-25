---
name: CAR signature evidence policy
description: Historical signature capture events and strict no-backfill boundaries for CAR Word reports.
---

Freeze the Originator signature at the finding's first actual creation/transition into a finding. Freeze Recipient and Action Taken by signatures from the assigned Action Taker at each actual response submission/resubmission; final acceptance retains that submission's evidence.

**Why:** Current profile signatures can be replaced or removed, which must not change historical CAR downloads. Creation and submission are the acts represented by the three mapped signature cells, rather than approval by a different person.

**How to apply:** Keep independent private, tenant/record-bound copies. Do not capture on draft saves, opening, downloads or approval, and never backfill old gaps from current profiles. Missing captured objects remain exactly “To be mapped”. Signature evidence must survive event-log retention; a failed durable snapshot write must prevent the corresponding workflow event from committing. Other signature cells remain outside the CAR mapping.
