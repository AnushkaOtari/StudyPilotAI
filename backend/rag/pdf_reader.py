import pymupdf

def extract_text(pdf_path):
    text = ""

    doc = pymupdf.open(pdf_path)

    for page in doc:
        text += page.get_text()

    doc.close()

    return text

def extract_text_by_page(pdf_path):
    pages = []
    doc = pymupdf.open(pdf_path)
    for i, page in enumerate(doc):
        pages.append((i + 1, page.get_text()))
    doc.close()
    return pages