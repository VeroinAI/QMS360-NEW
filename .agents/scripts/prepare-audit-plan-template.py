"""Remove sample text/data while retaining the supplied PDF's original branding."""
from pathlib import Path
import shutil
import fitz

source = Path("attached_assets/Audit_plan_for_CONSTRUCTION_OF_NEW_AFIF-1_AND_EXPANSION_OF_DAW_1791076726194.pdf")
assets = Path("artifacts/api-server/src/assets")
assets.mkdir(parents=True, exist_ok=True)
original = fitz.open(source)
blank = fitz.open()
# The final source page contains actual signatures: never copy it into the template.
blank.insert_pdf(original, from_page=0, to_page=2)
for page in blank:
    for block in page.get_text("dict")["blocks"]:
        if block["type"] == 0:
            for line in block["lines"]:
                for span in line["spans"]:
                    page.add_redact_annot(fitz.Rect(span["bbox"]), fill=False)
    page.apply_redactions(images=0, graphics=0)
# Activity rows are regenerated and paginated from the saved plan, not sample topics.
blank[1].draw_rect(fitz.Rect(34.5, 704, 560.5, 807), color=None, fill=(1, 1, 1))
blank[2].draw_rect(fitz.Rect(34.5, 145, 560.5, 811), color=None, fill=(1, 1, 1))
blank.set_metadata({})
blank.save(assets / "audit-plan-template.pdf", garbage=4, deflate=True)
assert not any(page.get_text().strip() for page in blank)
for name in ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"]:
    shutil.copyfile(Path("/usr/share/fonts/truetype/dejavu") / name, assets / name)
shutil.copyfile("/usr/share/doc/fonts-dejavu-core/copyright", assets / "audit-plan-font-license.txt")
print("Prepared blank branded template and licensed Unicode fonts.")