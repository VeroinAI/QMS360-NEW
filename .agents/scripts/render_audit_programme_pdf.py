import pymupdf
from pathlib import Path

source = Path("attached_assets/audit-programme-becce891-4447-4efa-9c12-3f3cee019d00_(3)_1789630101691.pdf")
output_dir = Path(".agents/outputs/audit-programme-pdf")
output_dir.mkdir(parents=True, exist_ok=True)

document = pymupdf.open(source)
print(f"pages={document.page_count}")
for index, page in enumerate(document):
    output = output_dir / f"page-{index + 1}.png"
    page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False).save(output)
    print(output)