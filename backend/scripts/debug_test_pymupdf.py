import sys
import pymupdf4llm

try:
    doc_path = sys.argv[1] if len(sys.argv) > 1 else "sample.pdf"
    chunks = pymupdf4llm.to_markdown(doc=doc_path, page_chunks=True)
    if chunks:
        print("Keys:", chunks[0].keys())
        if "metadata" in chunks[0]:
            print("Metadata:", chunks[0]["metadata"])
except Exception as e:
    print("Error:", e)
