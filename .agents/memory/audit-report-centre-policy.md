---
name: Audit report centre
description: Workbook-based Audit Reports landing-page scope and source-data rules.
---

The Audit Reports landing page is four switchable tabular reports: Open vs Closed Audits, Findings Log, CAR Status & Closure, and Annual Audit Schedule. Preserve the supplied workbook's column names and order rather than replacing these reports with summary tiles.

**Why:** The user supplied the four-sheet workbook as the required layout and explicitly requested removal of the previous Reports tiles.

**How to apply:** Use Reports-specific read/export role scopes, including projectless Process audits. Reports are read-only projections: combine current checklist and standalone historical findings without double-counting mirrored rows, never create CARs or issue identifiers while reading, and leave unrecorded dates/identifiers as missing rather than inferring them from unrelated timestamps.

The Year dropdown must list only years with authorized data in the selected report, not a preset calendar range. Keep this list independent of the selected year and pagination so users can switch between populated years.

**Why:** The user explicitly requested that years with no report data must not appear.
