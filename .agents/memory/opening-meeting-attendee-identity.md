---
name: Audit meeting attendee identity
description: How QMS Audit Opening and Closing Meeting attendees are selected and displayed across old and new minutes.
---

New Opening and Closing Meeting attendee selections are stored as Audit user IDs, not display names. Keep existing free-text attendee values readable and retain them when editing older minutes.

**Why:** User selection must distinguish people with the same name, while existing manually entered meeting records must remain intact.

**How to apply:** Offer only active users with approved Audit application access and active Audit roles for new selections in either meeting. Resolve IDs to names in the editor and reports; never print raw IDs as attendee names.

The Closing meeting's “Not Represented in closing meeting” field is the
opening-meeting attendee identities minus the closing-meeting attendee
identities. It is shown after Attendees using the same dropdown presentation,
with all missing attendees automatically selected and no direct editing.

**Why:** On 2026-10-09 the user explicitly requested this business rule without
changing the other Audit workspace behavior.

**How to apply:** Derive the field from the saved opening attendees and current
closing draft so it updates immediately on selection changes and naturally
survives save/reopen. Do not store an independently editable missing-attendee
list or compare display names: different users may share the same name. Keep
legacy typed attendees readable.