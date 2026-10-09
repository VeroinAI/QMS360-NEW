---
name: Checklist evidence vs import
description: The explicit separation between attaching Checklist evidence and importing workbook rows.
---

Checklist Excel import identity is the trimmed **Clause + Audit Area + Audit
Question** combination within the current audit. Matching rows update other
imported columns while preserving their IDs, evidence and workflow links.
Unmatched combinations insert rows even if copied from an export with an Item
ID. Repeated combinations in one workbook affect the same row.

**Why:** On 2026-10-09 the user reported duplicated records after editing a
downloaded workbook and explicitly requested these three columns as the unique
import key, with no unrelated changes.

**How to apply:** Match server-side against the locked audit state, not solely
against hidden workbook IDs. Do not delete historical duplicate records or
apply this rule to unrelated finding-only items or manual editing.

The Checklist item's Evidence picker always attaches the selected file to that item, even if it is an Excel template. Importing worksheet rows is reserved for the separate Upload Excel control in the Checklist header. Do not automatically reinterpret an Evidence selection as a workbook import.

**Why:** The user explicitly clarified that clicking Evidence and attaching a file should store it as an attachment through QMS360's existing process; earlier attempts to redirect or offer workbook import from that picker did not match the requested behavior.

**How to apply:** Keep the Evidence picker and workbook import separate. Evidence uses the authenticated QMS360 file-upload flow and is linked to its Checklist item; only Upload Excel parses worksheet rows. Make both controls' labels explain the distinction without blocking attachment of a workbook.