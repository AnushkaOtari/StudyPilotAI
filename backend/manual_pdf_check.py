from rag.pdf_reader import extract_text

text = extract_text("test.pdf")

print(text[:1000])