---
name: Selection search contracts
description: Why selection search uses an input-owning combobox and how native form bridges must preserve navigation
---

Search must own editable input focus rather than compete with a selection menu's
built-in type-ahead and selected-item autofocus.

**Why:** Adding a textbox inside Radix Select looked correct but its positioning
and focus effects subsequently moved focus back onto an option. Interaction
tests caught this even though typing, types and static rendering looked valid.
The searchable single-selection implementation therefore uses the combobox
interaction model instead of embedding an input into the old Select listbox.

**How to apply:** Preserve stored values and the entire eligible option set
separately from search text. Test actual initial focus, typing spaces, arrow/Enter
selection, Escape return and nested dialogs whenever changing selection internals.
Retain legacy/unavailable removal and whole-set bulk actions independently of
the filtered rows.

Native compatibility bridges must not duplicate validation-path attributes or
element IDs from their visible searchable controls.

**Why:** Validation navigation finds the first matching field; duplicating its
path on a hidden native select can focus the hidden bridge instead of the
visible field, silently breaking correction of invalid report entries.

**How to apply:** Put label IDs, validation paths and test IDs on the visible
control; reserve the native bridge for actual form values/change events.
