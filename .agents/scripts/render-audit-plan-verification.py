"""Render representative Audit Plan PDFs without modifying their contents."""
import sys
from pathlib import Path
import pymupdf

out = Path("generated-artifacts/audit-plan-verification")
out.mkdir(parents=True, exist_ok=True)
for filename in sys.argv[1:]:
    doc = pymupdf.open(filename)
    for index in sorted({0, 1, min(2, len(doc) - 1), len(doc) - 1}):
        doc[index].get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(
            out / f"{Path(filename).stem}-{index + 1}.png")
    print(f"{filename}: {len(doc)} pages")
