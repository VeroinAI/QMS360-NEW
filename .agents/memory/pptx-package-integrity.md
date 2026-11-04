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

DrawingML paragraph-property children also have a required order: line spacing,
space-before and space-after precede bullet properties (such as `buNone`) and
default run properties. Insert spacing before the preserved bullet/style
children, not at the end of `pPr`.

PowerPoint table text can still wrap in LibreOffice even with `wrap="none"`.
Explicit line budgets need conservative glyph widths, italic-font safety and
allowance for cell margins plus body insets.

**Why:** A structurally valid table passed line-count tests but wide repeated
glyphs wrapped again in a rendered download and expanded beyond its row/footer.

**How to apply:** Inspect an actual office-rendered long-text fixture, including
wide unbroken strings, rather than trusting XML line counts or no-autofit flags.

**Why:** The photographic template already contains bullet properties. Adding
explicit caption spacing by appending children produces schema-invalid
DrawingML even when paragraph runs themselves are correctly ordered.

**How to apply:** Check both paragraph and paragraph-property ordering whenever
adding explicit line layout to template text boxes.

When cloning table body rows, use an interior-row prototype rather than the
first body row, unless the first-row border exceptions are intentionally wanted.

**Why:** The Audit summary template suppresses the first body's top border.
Repeating that prototype caused Office rendering to suppress separators between
actual entries even though each cloned row retained a bottom border.

**How to apply:** Keep the header, ordinary body and grand Total styling distinct;
check row separators in an office-rendered export after rebuilding dynamic tables.
