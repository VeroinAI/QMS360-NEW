from pathlib import Path

import pymupdf


source = Path("attached_assets/Algihaz-Schedule_Layout_1789552026502.pdf")
output = Path(".agents/outputs")
output.mkdir(parents=True, exist_ok=True)

document = pymupdf.open(source)
print(f"pages={document.page_count}")
for index, page in enumerate(document):
    destination = output / f"algihaz-schedule-page-{index + 1}.png"
    page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False).save(destination)
    print(f"{destination} {page.rect.width}x{page.rect.height}")