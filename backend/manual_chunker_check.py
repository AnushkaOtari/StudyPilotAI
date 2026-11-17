from rag.pdf_reader import extract_text
from rag.chunker import chunk_text

text = extract_text("test.pdf")

chunks = chunk_text(text)

print("Number of chunks:", len(chunks))

print("\nFirst Chunk:\n")

print(chunks[0])