---
name: Spreadsheet date policy
description: Organization-selected date presentation, strict spreadsheet parsing and unchanged ISO contracts.
---

QMS360 dates use the organization's configured format across platform, Lessons,
QA/QC and Audit displays, date entry, PDF/Word reports and Excel/CSV boundaries.
DD/MM/YYYY is the default, not a mandatory fixed policy.

**Why:** The user's organization-wide date-format request supersedes the earlier
spreadsheet-only, fixed day-first requirement. Presentation must change without
changing calendar dates, timestamps, workflow data or internal ISO contracts.

**How to apply:** Use the authenticated organization's preference, never browser
locale or a process-global mutable server preference. Server formatting must be
request/job-local so concurrent organizations cannot affect each other. Inputs
and uploads normalize to ISO before validation/persistence. Interpret ambiguous
numeric dates strictly using the selected or explicitly declared source format;
never guess another order. Reject impossible dates. Keep ordinary text, names,
references, metric counts and unsaved form data untouched.

Older unambiguous ISO-date workbooks remain accepted, as do genuine native Excel
date cells using their workbook's 1900 or 1904 date system.

**Why:** Previously downloaded templates must stay usable, and treating all
workbooks as 1900-based silently shifts dates from 1904-based files.

**How to apply:** Preserve legacy heading aliases and explicit source-format
declarations when importing older files, even after the preference changes.
New headings and instructions use the current preference. Reject conflicting
format declarations rather than interpreting rows differently. Do not use
locale-dependent JavaScript parsing for numeric date text.

XLSX date cells must contain native Excel dates with the explicit custom number
format corresponding to the organization preference, including blank date-entry
cells and columns. Formatted text alone does not make a real Excel date.

**Why:** The user reported that date formatting still depended on system defaults
after the text-format change. Native date cells with a fixed custom format also
preserve Excel's date sorting and filtering.

**How to apply:** Verify both the serialized cell type and its stored number
format after reopening a generated workbook. Styled blank cells must stay truly
blank; they must not become zero/1899 dates or additional import records. CSV
cannot store Excel cell types or number formats, so keep its selected-format
text behavior separate from XLSX styling.

Date entry must retain its original format while the user is actively editing.
Preference refreshes must not reinterpret ambiguous text or discard drafts.
Callbacks and native form submissions must keep the existing ISO contract.

**Why:** Text such as 03/04/2026 is valid in both day-first and month-first
formats but means different calendar dates. Reinterpreting an in-progress value
when another administrator changes the preference can silently change its meaning.

**How to apply:** Keep the editing format until the input can be normalized
without changing its date, then repaint using the new preference. Preserve invalid
text for correction instead of clearing it or fabricating a time. Keep calendar
controls subject to the same read-only and disabled field restrictions as typing.