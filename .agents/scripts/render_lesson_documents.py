from pathlib import Path

import fitz


OUTPUT = Path(".agents/outputs/lesson-document-review")
OUTPUT.mkdir(parents=True, exist_ok=True)

for source in [
    Path("attached_assets/Sample-LL_1789198832967.pdf"),
    OUTPUT / "SHEQ-01-SF-005_-_Lesson_Learned_Form_1789198914182.pdf",
]:
    document = fitz.open(source)
    print(source, "pages", document.page_count)
    for index, page in enumerate(document):
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        target = OUTPUT / f"{source.stem}-page-{index + 1}.png"
        pixmap.save(target)
        print(target, page.rect)