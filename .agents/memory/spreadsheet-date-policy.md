---
name: Spreadsheet date policy
description: Day-first dates at Excel and CSV boundaries, without changing application date contracts.
---

All QMS360 Excel downloads and uploads use **DD/MM/YYYY**, including workbook
headings, template instructions and dates inside supported JSON spreadsheet
cells. CSV reports opened in Excel follow the same date display policy.

**Why:** The user requested consistent spreadsheet dates without impacting
other development. Changing API, database, native form or PDF date formats is
outside this requirement and could break existing workflows.

**How to apply:** Format dates only at spreadsheet export boundaries; normalize
day-first uploads back to the existing internal ISO date contract before
validation or persistence. Slash dates always mean day/month/year. Reject
impossible calendar dates before saving anything. Keep ordinary text, names,
references and metric counts untouched.

Older unambiguous ISO-date workbooks remain accepted, as do genuine native Excel
date cells using their workbook's 1900 or 1904 date system.

**Why:** Previously downloaded templates must stay usable, and treating all
workbooks as 1900-based silently shifts dates from 1904-based files.

**How to apply:** Preserve legacy heading aliases and ISO input compatibility
while generating only DD/MM/YYYY guidance in new templates. Do not use locale-
dependent JavaScript date parsing to interpret slash-date text.

XLSX date cells must contain native Excel dates with the explicit custom number
format `dd/mm/yyyy`, including blank date-entry cells and columns. Merely writing
DD/MM/YYYY text does not make it a real Excel date.

**Why:** The user reported that date formatting still depended on system defaults
after the text-format change. Native date cells with a fixed custom format also
preserve Excel's date sorting and filtering.

**How to apply:** Verify both the serialized cell type and its stored number
format after reopening a generated workbook. Styled blank cells must stay truly
blank; they must not become zero/1899 dates or additional import records. CSV
cannot store Excel cell types or number formats, so keep its day-first text
behavior separate from XLSX styling.