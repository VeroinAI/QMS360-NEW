from pathlib import Path
import fitz

source = Path("attached_assets/Audit_plan_for_CONSTRUCTION_OF_NEW_AFIF-1_AND_EXPANSION_OF_DAW_1791076726194.pdf")
out = Path("/tmp/audit-plan-template")
out.mkdir(exist_ok=True)
doc = fitz.open(source)
print("Pages:", len(doc))
for i, page in enumerate(doc):
    print("PAGE", i + 1, page.rect)
    print(page.get_text())
    page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(out / f"page-{i + 1}.png")
    print("WIDGETS:", [(w.field_name, w.rect) for w in page.widgets()])