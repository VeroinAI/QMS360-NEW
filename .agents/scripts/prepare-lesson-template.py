"""Convert the supplied Word form once; runtime PDF generation needs no office tools."""
import argparse
from pathlib import Path
import subprocess
import fitz

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("--output", type=Path, default=Path("artifacts/api-server/src/assets/lesson-learned-template.pdf"))
args = parser.parse_args()
work = Path("generated-artifacts/lesson-form")
work.mkdir(parents=True, exist_ok=True)
converted = work / f"{args.source.stem}.pdf"
converted.unlink(missing_ok=True)
subprocess.run([
    "libreoffice", "-env:UserInstallation=file:///tmp/lo-lesson-template",
    "--headless", "--convert-to", "pdf", "--outdir", str(work), str(args.source),
], check=True)
document = fitz.open(converted)
assert len(document) == 1, "The revised form must be a single-page template"
for page in document:
    # Word content controls use the serif placeholder font; labels/header/footer
    # use sans-serif. Remove only the prompts, not their borders or backgrounds.
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                if span["font"] == "DejaVuSerif":
                    assert span["text"].strip().startswith(("Click or tap", "Choose an item", "text."))
                    page.add_redact_annot(fitz.Rect(span["bbox"]), fill=False)
    page.apply_redactions(images=0, graphics=0)
assert "Click or tap" not in "".join(page.get_text() for page in document)
args.output.parent.mkdir(parents=True, exist_ok=True)
document.save(args.output, garbage=4, deflate=True)
print(f"Saved clean Word-derived template: {args.output}")
