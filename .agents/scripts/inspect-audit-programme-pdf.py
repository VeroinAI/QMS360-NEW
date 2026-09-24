import pymupdf

source = "attached_assets/audit-programme-63cb3ce0-8003-4438-86f4-83052ca26ba5_(1)_1790231506458.pdf"
document = pymupdf.open(source)
print("pages", document.page_count, "size", document[0].rect)
page = document[-1]
page.get_pixmap(matrix=pymupdf.Matrix(1, 1)).save(".agents/outputs/audit-programme-reference.png")