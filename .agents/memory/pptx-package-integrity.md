---
name: PowerPoint package integrity
description: DrawingML child ordering and pristine template cloning for valid Audit Report exports.
---

Keep DrawingML paragraph properties in schema order: optional paragraph
properties first, then text runs/fields/breaks, and optional end-paragraph
properties last. A well-formed XML document is not necessarily valid PowerPoint
XML, especially when populating an originally empty template cell.

Clone each continuation slide and its relationships from an untouched template
snapshot, never from an already-rendered page. Relationship IDs must be unique
within each relationship part.

**Why:** A production Audit Report download contained text runs after
end-paragraph properties and duplicate image relationships on photographic
continuations. ZIP checks and XML parsing alone did not detect these violations.

**How to apply:** Test exports with empty cells, multiline text, and multiple
photographic pages. Check paragraph child ordering, per-part relationship ID
uniqueness, and relationship targets alongside preservation of branding and
record content. Do not treat a successful archive write as proof that
PowerPoint can open the file.
