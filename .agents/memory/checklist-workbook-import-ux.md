---
name: Checklist workbook import UX
description: Why Checklist templates selected in the item evidence picker should offer import in place.
---

If a Checklist template is selected from an item's evidence picker, offer an explicit way to import it from that context rather than just telling the user to close the editor and find another upload control. Warn that unsaved item edits will be discarded on a successful import, and leave the editor intact if the import fails.

**Why:** A warning-only redirect was encountered repeatedly as an error; it did not help the user finish the workbook import.

**How to apply:** When adjusting Checklist upload or attachment flows, distinguish spreadsheet evidence from a Checklist template by workbook contents as well as its download filename, and keep a direct import path available wherever users select a template.