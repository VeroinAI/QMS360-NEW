---
name: PDF library normalization
description: Validate unsupported source PDF structures before library normalization hides them.
---

Validate source PDF structures before invoking form APIs that normalize them. In pdf-lib, accessing a form can silently remove XFA data; saving a generated fixture with default appearance updates can do the same.

**Why:** An XFA rejection test initially appeared to pass inspection because the fixture was normalized before upload, not because the unsupported form was safe. This can produce false confidence in file validation.

**How to apply:** Inspect decoded dictionaries for unsupported or active structures before form access. For rejection fixtures, disable appearance updates during save so the original problematic structure reaches the validator.

Do not identify PDF fields by `constructor.name`; use the library's class/type APIs.

**Why:** The API server bundle can rename a class (for example, a text field gains a numeric suffix). A source-mode test passes while the packaged server rejects legitimate fields.

**How to apply:** Keep stable field type names at API/storage boundaries, and include a packaged-server or renamed-constructor regression check for field handling.

PDF text extraction and successful parsing do not prove embedded fonts render correctly. Render and inspect at least one populated page whenever font embedding or shaping changes.

**Why:** A monthly report preserved its full extracted text while many glyphs were visually absent; changing font subsetting alone still left ligature-related spacing/rendering problems. Structural checks cannot catch these failures.